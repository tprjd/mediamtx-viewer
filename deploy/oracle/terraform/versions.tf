terraform {
  required_version = ">= 1.8.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 8.27"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.1"
    }
  }
}

provider "oci" {
  auth                = var.oci_auth
  config_file_profile = var.oci_profile
  region              = var.region
}
