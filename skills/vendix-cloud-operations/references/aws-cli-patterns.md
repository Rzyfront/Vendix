# AWS CLI patterns (read-only, projected output)

Region `us-east-1`. Secrets Manager: list/describe only — never commands that print secret payloads.

```bash
aws ec2 describe-instances --region us-east-1 \
  --filters Name=instance-state-name,Values=running,stopped \
  --query 'Reservations[].Instances[].{InstanceId:InstanceId,Name:Tags[?Key==`Name`]|[0].Value,State:State.Name,PublicIp:PublicIpAddress,InstanceType:InstanceType,KeyName:KeyName}' \
  --output table

aws cloudfront list-distributions \
  --query 'DistributionList.Items[].{Id:Id,DomainName:DomainName,Status:Status,Enabled:Enabled,Aliases:Aliases.Items}' \
  --output table

aws ecr describe-images --region us-east-1 --repository-name vendix-backend \
  --query 'sort_by(imageDetails,& imagePushedAt)[-5:].{tags:imageTags,pushed:imagePushedAt,digest:imageDigest}' \
  --output json

aws secretsmanager list-secrets --region us-east-1 --filters Key=name,Values=vendix/production \
  --query 'SecretList[].{Name:Name,LastChangedDate:LastChangedDate,Description:Description}' --output table

aws logs describe-log-groups --region us-east-1 \
  --query 'logGroups[].{Name:logGroupName,Retention:retentionInDays,StoredBytes:storedBytes}' --output table
```

Other sources: `aws route53 list-resource-record-sets` (+ `dig`), `aws s3api list-buckets` /
`get-bucket-website` / `get-bucket-location`, `aws rds describe-db-instances`,
`aws ses list-identities` / `get-identity-verification-attributes`, `aws cloudwatch …`,
`aws sts get-caller-identity` (access context).
