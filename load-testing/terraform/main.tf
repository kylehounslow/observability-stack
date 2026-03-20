# Load Generator EC2 instance in the same VPC as the EKS cluster.
# Runs k6 against the ALB endpoint — real end-to-end path including TLS + WAF.
#
# Usage:
#   cd load-testing/terraform
#   terraform init
#   terraform apply -var="vpc_id=vpc-xxx" -var="subnet_id=subnet-xxx" -var="target_url=https://obs-playground-dev-..."
#
#   # SSH in and run tests:
#   ssh -i ~/.ssh/load-test-key.pem ec2-user@<public_ip>
#   cd /home/ec2-user/k6 && k6 run scenarios/api-queries.js
#
#   # Destroy when done:
#   terraform destroy

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = var.region
}

variable "region" {
  default = "us-west-2"
}

variable "vpc_id" {
  description = "VPC ID where EKS cluster runs (from main terraform output)"
  type        = string
}

variable "subnet_id" {
  description = "Public subnet ID in the same VPC"
  type        = string
}

variable "target_url" {
  description = "ALB URL for OpenSearch Dashboards (e.g. https://obs-playground-dev-....people.aws.dev)"
  type        = string
}

variable "opensearch_user" {
  default = "admin"
}

variable "opensearch_password" {
  default = "My_password_123!@#"
}

variable "instance_type" {
  description = "EC2 instance type — m5.xlarge recommended for 1000+ VUs"
  default     = "m5.xlarge"
}

variable "key_name" {
  description = "EC2 key pair name for SSH access. Leave empty to skip SSH."
  default     = ""
}

# --- Security Group ---
resource "aws_security_group" "load_generator" {
  name_prefix = "load-test-"
  vpc_id      = var.vpc_id

  # SSH (optional)
  dynamic "ingress" {
    for_each = var.key_name != "" ? [1] : []
    content {
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }

  # All outbound (to reach ALB)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "load-test-generator" }
}

# --- Latest Amazon Linux 2023 AMI ---
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
  filter {
    name   = "state"
    values = ["available"]
  }
}

# --- User Data: install k6 + copy scripts ---
locals {
  user_data = <<-EOF
    #!/bin/bash
    set -euo pipefail

    # Install k6
    dnf install -y https://dl.k6.io/rpm/repo.rpm || true
    dnf install -y k6 || {
      # Fallback: install from binary
      curl -sL https://github.com/grafana/k6/releases/latest/download/k6-linux-amd64.tar.gz | tar xz
      mv k6-*/k6 /usr/local/bin/
    }

    # Create k6 scripts directory
    mkdir -p /home/ec2-user/k6/scenarios

    # Write environment config
    cat > /home/ec2-user/k6/.env <<'ENVEOF'
    export DASHBOARDS_URL="${var.target_url}"
    export OSD_USER="${var.opensearch_user}"
    export OSD_PASSWORD="${var.opensearch_password}"
    export OPENSEARCH_URL="${var.target_url}/api/console/proxy?path=/"
    export PROMETHEUS_URL="${var.target_url}/api/console/proxy?path=/"
    ENVEOF

    chown -R ec2-user:ec2-user /home/ec2-user/k6

    echo "✅ Load generator ready. Upload k6 scripts to /home/ec2-user/k6/"
  EOF
}

# --- EC2 Instance ---
resource "aws_instance" "load_generator" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [aws_security_group.load_generator.id]
  associate_public_ip_address = true
  key_name                    = var.key_name != "" ? var.key_name : null
  user_data                   = local.user_data

  root_block_device {
    volume_size = 20
  }

  tags = {
    Name      = "load-test-generator"
    Project   = "observability-stack"
    ManagedBy = "terraform"
  }
}

# --- Outputs ---
output "instance_id" {
  value = aws_instance.load_generator.id
}

output "public_ip" {
  value = aws_instance.load_generator.public_ip
}

output "ssh_command" {
  value = var.key_name != "" ? "ssh -i ~/.ssh/${var.key_name}.pem ec2-user@${aws_instance.load_generator.public_ip}" : "No SSH key configured — use SSM: aws ssm start-session --target ${aws_instance.load_generator.id}"
}

output "upload_scripts" {
  value = var.key_name != "" ? "scp -i ~/.ssh/${var.key_name}.pem -r ../k6/ ec2-user@${aws_instance.load_generator.public_ip}:/home/ec2-user/k6/" : "Use SSM or attach scripts via user_data"
}

output "run_test" {
  value = "k6 run --env TARGET_VUS=1000 --env DASHBOARDS_URL=${var.target_url} scenarios/api-queries.js"
}
