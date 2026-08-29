# Oracle infrastructure

This module provisions the Oracle network and compute resources for the
MediaMTX viewer:

- Dedicated VCN and public subnet
- Internet gateway and explicit route table
- Security list exposing only HTTPS, ACME HTTP, WebRTC UDP, and restricted SSH
- Always Free-oriented Ampere A1 VM running Ubuntu 24.04
- Reserved public IPv4 address
- Cloud-init bootstrap for Docker, Compose, UFW, and WebRTC socket buffers

It does not create DNS records or deploy application secrets.

## Prerequisites

1. Install Terraform 1.8+ or OpenTofu 1.8+.
2. Authenticate the OCI CLI profile referenced by `oci_profile`.
3. Copy `terraform.tfvars.example` to `terraform.tfvars` and fill in the
   tenancy/compartment OCID and current trusted SSH CIDR.
4. Ensure `ssh_public_key_path` points to an existing public key. Never use the
   private key path here.

The current browser-backed profile uses a one-hour security token. Refresh or
recreate it before `plan`, `apply`, or `destroy` when it has expired.

## Commands

```sh
tofu init
tofu fmt -check
tofu validate
tofu plan -out=tfplan
tofu apply tfplan
```

Terraform commands are identical when using the `terraform` binary.

If A1 capacity is unavailable, increment `availability_domain_index` and apply
again. Frankfurt currently exposes three indices: `0`, `1`, and `2`.

After a successful apply, point the public hostname at the `public_ip` output,
wait for DNS propagation, and deploy the Docker Compose application stack.

## Existing-resource import

If an earlier manual setup already created resources, import them before
planning. Import only resources whose configuration matches this module:

```sh
tofu import oci_core_vcn.viewer <vcn-ocid>
tofu import oci_core_internet_gateway.viewer <internet-gateway-ocid>
tofu import oci_core_subnet.viewer <subnet-ocid>
```

Always inspect `tofu plan` after importing. State files, variable files, and
saved plans are intentionally excluded from Git.
