# Oracle infrastructure

This module provisions the Oracle network and compute resources for the
MediaMTX viewer:

- Dedicated VCN and public subnet
- Internet gateway and explicit route table
- Security list exposing HTTPS/HTTP3, ACME HTTP, WebRTC UDP/TCP ICE, and key-only SSH
- Always Free-oriented Ampere A1 VM running Ubuntu 24.04
- Reserved public IPv4 address
- Exact-instance dynamic group and read-only usage/monitoring policy
- Cloud-init bootstrap for Docker, Compose, matching UFW rules, and WebRTC socket buffers

It does not create DNS records or deploy application secrets.

## Prerequisites

1. Install Terraform 1.8+ or OpenTofu 1.8+.
2. Authenticate the OCI CLI profile referenced by `oci_profile`.
3. Copy `terraform.tfvars.example` to `terraform.tfvars` and fill in the
   tenancy/compartment OCID. Keep the default SSH CIDR for a changing workstation IP.
4. Ensure `ssh_public_key_path` points to an existing public key. Never use the
   private key path here.

The current browser-backed profile uses a one-hour security token. Refresh or
recreate it before `plan`, `apply`, or `destroy` when it has expired.

`compartment_ocid` currently points at the root tenancy. If the application is
moved into a child compartment, set `tenancy_ocid` separately so the dynamic
group and tenancy usage-report policy are created at the root while compute,
volume, and metric reads remain limited to the application compartment.

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

## SSH access with a changing IP

The default `ssh_allowed_cidr` is `0.0.0.0/0`. Oracle and UFW accept IPv4 SSH
connections from any address. OpenSSH requires a public key and disables
password, keyboard-interactive, empty-password, and direct root login.
Use the `ubuntu` account with the private key that matches `ssh_public_key_path`.
A workstation IP change does not require a firewall update.

For a fixed deployment address, you can set `ssh_allowed_cidr` to its `/32`.
That restriction applies in addition to key authentication.

### Update an existing VM

Cloud-init runs at first boot. A Terraform or OpenTofu apply does not update
OpenSSH or UFW on an existing VM. Keep an SSH session open during this change.

1. Install the SSH settings from `cloud-init.yaml.tftpl` in
   `/etc/ssh/sshd_config.d/00-mediamtx-key-only.conf` on the VM.
2. Validate the configuration and reload SSH:

   ```sh
   sudo /usr/sbin/sshd -t
   sudo systemctl reload ssh
   sudo /usr/sbin/sshd -T | grep -E '^(authenticationmethods|pubkeyauthentication|passwordauthentication|kbdinteractiveauthentication|permitemptypasswords|permitrootlogin) '
   ```

   Confirm `authenticationmethods publickey`, `pubkeyauthentication yes`,
   and `no` for the other four settings before you open the firewall.
3. Set `ssh_allowed_cidr = "0.0.0.0/0"` in your existing `terraform.tfvars`.
4. Apply the Oracle security-list change:

   ```sh
   tofu plan -target=oci_core_security_list.viewer -out=tfplan-ssh
   tofu apply tfplan-ssh
   ```

   Inspect the plan. It must not replace the VM or its boot volume.
5. Allow IPv4 SSH through UFW:

   ```sh
   sudo ufw allow from 0.0.0.0/0 to any port 22 proto tcp
   ```

6. Open a second SSH connection with your deployment key. Confirm that it works
   before you close the first connection or remove obsolete `/32` SSH rules.

If your previous IP restriction already blocks SSH, use an existing trusted
connection or an authenticated Oracle recovery path to update UFW first.
Changing only the Oracle rule does not bypass the VM firewall.

The instance lifecycle ignores later `user_data` changes. This prevents a
bootstrap change from replacing the VM and boot volume.

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

## Statistics-page permissions

With `enable_oracle_statistics = true`, the module matches only the viewer
instance OCID in a fallback dynamic group for compute, volume, and metric reads.
It also creates a dedicated OCI user and group with read-only access to usage
reports, compute/volume inventory, and metrics; disables all of that user's
credential types except API keys; and generates one RSA key.
The private key and its non-secret identifiers are written with mode `0600` to
the git-ignored `deploy/oracle/secrets/oci-usage-api-key.pem` and
`oci-usage.env`. After apply, encrypt them into the tracked
`deploy/oracle/secrets.enc/` directory:

```sh
./deploy/oracle/sops-secrets.sh encrypt
```

The deployment script decrypts those files into a temporary directory and
copies them to the VM, where they are mounted read-only. Keep the plaintext
Terraform-written files out of Git.

Set `statistics_usage_user_email` in `terraform.tfvars`; OCI Identity Domains
requires a primary email even though this service identity has no console
password. Treat the Terraform state as sensitive because it contains the key.

The instance configuration also enables the **Compute Instance Monitoring**
Oracle Cloud Agent plugin. On an older imported Ubuntu VM, confirm the agent is
installed as a snap before applying:

```sh
snap list oracle-cloud-agent
```

If it is missing, follow Oracle's Ubuntu agent installation instructions before
expecting memory, load, disk, and network series. Billing and allocation remain
usable when monitoring-agent data is absent.
