output "availability_domain" {
  description = "Availability domain used by the viewer VM."
  value       = oci_core_instance.viewer.availability_domain
}

output "instance_id" {
  description = "OCID of the viewer VM."
  value       = oci_core_instance.viewer.id
}

output "public_ip" {
  description = "Reserved public IPv4 address to assign to the public hostname."
  value       = oci_core_public_ip.viewer.ip_address
}

output "ssh_command" {
  description = "SSH command for the Ubuntu image."
  value       = "ssh ubuntu@${oci_core_public_ip.viewer.ip_address}"
}

output "viewer_url" {
  description = "Final viewer URL after DNS and TLS cutover."
  value       = "https://${var.hostname}"
}

output "statistics_dynamic_group" {
  description = "Dynamic group used by the viewer's instance-principal OCI integration."
  value       = var.enable_oracle_statistics ? oci_identity_dynamic_group.viewer_statistics[0].name : null
}
