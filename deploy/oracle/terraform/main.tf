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
