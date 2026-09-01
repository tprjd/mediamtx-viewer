data "oci_identity_availability_domains" "available" {
  compartment_id = var.compartment_ocid
}

data "oci_core_images" "ubuntu" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = var.instance_shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

locals {
  availability_domain = data.oci_identity_availability_domains.available.availability_domains[var.availability_domain_index].name
  image_ocid          = coalesce(var.image_ocid, data.oci_core_images.ubuntu.images[0].id)
  tenancy_ocid        = coalesce(var.tenancy_ocid, var.compartment_ocid)
  common_tags = {
    project  = var.project_name
    hostname = var.hostname
  }
}

resource "oci_core_vcn" "viewer" {
  compartment_id = var.compartment_ocid
  cidr_blocks    = ["10.42.0.0/16"]
  display_name   = "${var.project_name}-vcn"
  dns_label      = "mediamtx"
  freeform_tags  = local.common_tags
}

resource "oci_core_internet_gateway" "viewer" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.viewer.id
  display_name   = "${var.project_name}-igw"
  enabled        = true
  freeform_tags  = local.common_tags
}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.viewer.id
  display_name   = "${var.project_name}-public-routes"
  freeform_tags  = local.common_tags

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.viewer.id
  }
}

resource "oci_core_security_list" "viewer" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.viewer.id
  display_name   = "${var.project_name}-security"
  freeform_tags  = local.common_tags

  egress_security_rules {
    destination      = "0.0.0.0/0"
    destination_type = "CIDR_BLOCK"
    protocol         = "all"
  }

  ingress_security_rules {
    description = "SSH from the deployment workstation"
    protocol    = "6"
    source      = var.ssh_allowed_cidr
    source_type = "CIDR_BLOCK"

    tcp_options {
      min = 22
      max = 22
    }
  }

  ingress_security_rules {
    description = "HTTP for ACME and HTTPS redirect"
    protocol    = "6"
    source      = "0.0.0.0/0"
    source_type = "CIDR_BLOCK"

    tcp_options {
      min = 80
      max = 80
    }
  }

  ingress_security_rules {
    description = "HTTPS viewer and WHIP/WHEP signaling"
    protocol    = "6"
    source      = "0.0.0.0/0"
    source_type = "CIDR_BLOCK"

    tcp_options {
      min = 443
      max = 443
    }
  }

  ingress_security_rules {
    description = "MediaMTX WebRTC ICE"
    protocol    = "17"
    source      = "0.0.0.0/0"
    source_type = "CIDR_BLOCK"

    udp_options {
      min = 8189
      max = 8189
    }
  }

  ingress_security_rules {
    description = "ICMP fragmentation-needed messages for path MTU discovery"
    protocol    = "1"
    source      = "0.0.0.0/0"
    source_type = "CIDR_BLOCK"

    icmp_options {
      type = 3
      code = 4
    }
  }
}

resource "oci_core_subnet" "viewer" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.viewer.id
  cidr_block                 = "10.42.0.0/24"
  display_name               = "${var.project_name}-public-subnet"
  dns_label                  = "stream"
  prohibit_public_ip_on_vnic = false
  route_table_id             = oci_core_route_table.public.id
  security_list_ids          = [oci_core_security_list.viewer.id]
  freeform_tags              = local.common_tags
}

resource "oci_core_instance" "viewer" {
  availability_domain = local.availability_domain
  compartment_id      = var.compartment_ocid
  display_name        = var.project_name
  shape               = var.instance_shape
  freeform_tags       = local.common_tags

  shape_config {
    ocpus         = var.instance_ocpus
    memory_in_gbs = var.instance_memory_gb
  }

  create_vnic_details {
    assign_public_ip = false
    display_name     = "${var.project_name}-primary-vnic"
    hostname_label   = "viewer"
    subnet_id        = oci_core_subnet.viewer.id
  }

  source_details {
    source_type             = "image"
    source_id               = local.image_ocid
    boot_volume_size_in_gbs = var.boot_volume_size_gb
  }

  instance_options {
    are_legacy_imds_endpoints_disabled = true
  }

  agent_config {
    is_management_disabled = false
    is_monitoring_disabled = false

    plugins_config {
      desired_state = "ENABLED"
      name          = "Compute Instance Monitoring"
    }
  }

  metadata = {
    ssh_authorized_keys = trimspace(file(pathexpand(var.ssh_public_key_path)))
    user_data = base64encode(templatefile("${path.module}/cloud-init.yaml.tftpl", {
      ssh_allowed_cidr = var.ssh_allowed_cidr
    }))
  }

  lifecycle {
    # Cloud-init runs only when the instance is created. Updating the
    # workstation SSH CIDR later must not replace the VM and its boot volume;
    # apply the security-list change and update UFW on the running host instead.
    ignore_changes = [metadata["user_data"]]

    precondition {
      condition     = length(data.oci_core_images.ubuntu.images) > 0 || var.image_ocid != null
      error_message = "No compatible Ubuntu 24.04 image was found for the selected shape."
    }
  }
}

data "oci_core_private_ips" "viewer" {
  ip_address = oci_core_instance.viewer.private_ip
  subnet_id  = oci_core_subnet.viewer.id
}

resource "oci_core_public_ip" "viewer" {
  compartment_id = var.compartment_ocid
  display_name   = "${var.project_name}-public-ip"
  lifetime       = "RESERVED"
  private_ip_id  = data.oci_core_private_ips.viewer.private_ips[0].id
  freeform_tags  = local.common_tags
}

resource "oci_identity_dynamic_group" "viewer_statistics" {
  count = var.enable_oracle_statistics ? 1 : 0

  compartment_id = local.tenancy_ocid
  description    = "Allows the MediaMTX viewer VM to read its OCI health and tenancy usage."
  matching_rule  = "instance.id = '${oci_core_instance.viewer.id}'"
  name           = "${replace(var.project_name, "-", "_")}_statistics"
}

resource "oci_identity_policy" "viewer_statistics" {
  count = var.enable_oracle_statistics ? 1 : 0

  compartment_id = local.tenancy_ocid
  description    = "Read-only OCI usage and health access for the MediaMTX viewer statistics page."
  name           = "${replace(var.project_name, "-", "_")}_statistics"
  statements = [
    "Allow group id ${oci_identity_group.viewer_statistics_usage[0].id} to read usage-report in tenancy",
    "Allow group id ${oci_identity_group.viewer_statistics_usage[0].id} to inspect compartments in tenancy",
    "Allow group id ${oci_identity_group.viewer_statistics_usage[0].id} to inspect tenancies in tenancy",
    "Allow group id ${oci_identity_group.viewer_statistics_usage[0].id} to read metrics in compartment id ${var.compartment_ocid}",
    "Allow group id ${oci_identity_group.viewer_statistics_usage[0].id} to read instance-family in compartment id ${var.compartment_ocid}",
    "Allow group id ${oci_identity_group.viewer_statistics_usage[0].id} to read volume-family in compartment id ${var.compartment_ocid}",
    "Allow dynamic-group ${oci_identity_dynamic_group.viewer_statistics[0].name} to inspect compartments in tenancy",
    "Allow dynamic-group ${oci_identity_dynamic_group.viewer_statistics[0].name} to inspect tenancies in tenancy",
    "Allow dynamic-group ${oci_identity_dynamic_group.viewer_statistics[0].name} to read metrics in compartment id ${var.compartment_ocid}",
    "Allow dynamic-group ${oci_identity_dynamic_group.viewer_statistics[0].name} to read instance-family in compartment id ${var.compartment_ocid}",
    "Allow dynamic-group ${oci_identity_dynamic_group.viewer_statistics[0].name} to read volume-family in compartment id ${var.compartment_ocid}",
  ]
}

resource "oci_identity_user" "viewer_statistics_usage" {
  count = var.enable_oracle_statistics ? 1 : 0

  compartment_id = local.tenancy_ocid
  description    = "Read-only OCI API identity for the MediaMTX viewer statistics page."
  email          = var.statistics_usage_user_email
  name           = "${replace(var.project_name, "-", "_")}_statistics_usage"
}

resource "oci_identity_group" "viewer_statistics_usage" {
  count = var.enable_oracle_statistics ? 1 : 0

  compartment_id = local.tenancy_ocid
  description    = "Grants read-only OCI usage, inventory, and monitoring access to the statistics identity."
  name           = "${replace(var.project_name, "-", "_")}_statistics_usage"
}

resource "oci_identity_user_group_membership" "viewer_statistics_usage" {
  count = var.enable_oracle_statistics ? 1 : 0

  group_id = oci_identity_group.viewer_statistics_usage[0].id
  user_id  = oci_identity_user.viewer_statistics_usage[0].id
}

resource "oci_identity_user_capabilities_management" "viewer_statistics_usage" {
  count = var.enable_oracle_statistics ? 1 : 0

  can_use_api_keys             = true
  can_use_auth_tokens          = false
  can_use_console_password     = false
  can_use_customer_secret_keys = false
  can_use_smtp_credentials     = false
  user_id                      = oci_identity_user.viewer_statistics_usage[0].id
}

resource "tls_private_key" "viewer_statistics_usage" {
  count = var.enable_oracle_statistics ? 1 : 0

  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "oci_identity_api_key" "viewer_statistics_usage" {
  count = var.enable_oracle_statistics ? 1 : 0

  key_value = tls_private_key.viewer_statistics_usage[0].public_key_pem
  user_id   = oci_identity_user.viewer_statistics_usage[0].id
}

resource "local_sensitive_file" "viewer_statistics_usage_key" {
  count = var.enable_oracle_statistics ? 1 : 0

  content         = tls_private_key.viewer_statistics_usage[0].private_key_pem
  filename        = "${path.module}/../secrets/oci-usage-api-key.pem"
  file_permission = "0600"
}

resource "local_sensitive_file" "viewer_statistics_usage_env" {
  count = var.enable_oracle_statistics ? 1 : 0

  content         = <<-EOT
    OCI_USAGE_TENANCY_OCID=${local.tenancy_ocid}
    OCI_USAGE_USER_OCID=${oci_identity_user.viewer_statistics_usage[0].id}
    OCI_USAGE_FINGERPRINT=${oci_identity_api_key.viewer_statistics_usage[0].fingerprint}
    OCI_USAGE_PRIVATE_KEY_PATH=/run/secrets/oci-usage-api-key.pem
  EOT
  filename        = "${path.module}/../secrets/oci-usage.env"
  file_permission = "0600"
}
