variable "compartment_ocid" {
  description = "OCI compartment OCID. The tenancy OCID can be used for the root compartment."
  type        = string
}

variable "region" {
  description = "OCI region in which to create the deployment."
  type        = string
  default     = "eu-frankfurt-1"
}

variable "oci_profile" {
  description = "Profile from ~/.oci/config used by the OCI provider."
  type        = string
  default     = "mediamtx-deploy"
}

variable "oci_auth" {
  description = "OCI provider authentication method. Use SecurityToken for a browser-authenticated CLI profile."
  type        = string
  default     = "SecurityToken"
}

variable "project_name" {
  description = "Prefix used for OCI resource names and tags."
  type        = string
  default     = "mediamtx-viewer"
}

variable "hostname" {
  description = "Public hostname that will eventually point at the reserved OCI address."
  type        = string
  default     = "frankerzspam.duckdns.org"
}

variable "ssh_public_key_path" {
  description = "Path to the OpenSSH public key installed for the Ubuntu user."
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "ssh_allowed_cidr" {
  description = "Single trusted CIDR allowed to reach SSH, normally the deployment workstation's public IP with /32."
  type        = string

  validation {
    condition     = can(cidrhost(var.ssh_allowed_cidr, 0))
    error_message = "ssh_allowed_cidr must be a valid IPv4 or IPv6 CIDR."
  }
}

variable "availability_domain_index" {
  description = "Zero-based availability-domain index. Change this if A1 capacity is unavailable in the selected domain."
  type        = number
  default     = 0

  validation {
    condition     = var.availability_domain_index >= 0
    error_message = "availability_domain_index must be zero or greater."
  }
}

variable "instance_shape" {
  description = "Always Free-eligible flexible compute shape."
  type        = string
  default     = "VM.Standard.A1.Flex"
}

variable "instance_ocpus" {
  description = "OCPUs assigned to the flexible instance."
  type        = number
  default     = 1
}

variable "instance_memory_gb" {
  description = "Memory assigned to the flexible instance in GiB."
  type        = number
  default     = 6
}

variable "boot_volume_size_gb" {
  description = "Boot volume size in GiB."
  type        = number
  default     = 50
}

variable "image_ocid" {
  description = "Optional pinned OCI image OCID. When null, the newest Ubuntu 24.04 image compatible with the shape is selected."
  type        = string
  default     = null
  nullable    = true
}
