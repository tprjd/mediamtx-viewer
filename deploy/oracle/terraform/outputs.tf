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
