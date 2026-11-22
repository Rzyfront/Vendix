// Offline guard, no AWS needed: `node --test infra/agent-sandbox/python/template.test.cjs`.
// Pins the isolation shape of template.json and the backend invoke policy.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const template = JSON.parse(fs.readFileSync(path.join(__dirname, 'template.json'), 'utf8'));
const policy = JSON.parse(fs.readFileSync(path.join(__dirname, 'backend-invoke-policy.json'), 'utf8'));
const resources = Object.entries(template.Resources);
const ofType = (t) => resources.filter(([, r]) => r.Type === t).map(([, r]) => r);

test('no internet path: no IGW, NAT, endpoints or default routes', () => {
  const forbidden = /InternetGateway|NatGateway|VPCEndpoint|VPCGatewayAttachment|TransitGateway|VPNGateway|EIP$/;
  for (const [id, r] of resources) {
    assert.doesNotMatch(r.Type, forbidden, `${id} (${r.Type}) must not exist`);
  }
  assert.strictEqual(ofType('AWS::EC2::Route').length, 0);
});

test('no DNS channel: the VPC resolver is disabled (T53: security groups never filter Amazon DNS)', () => {
  const vpcs = ofType('AWS::EC2::VPC');
  assert.strictEqual(vpcs.length, 1);
  assert.strictEqual(vpcs[0].Properties.EnableDnsSupport, false);
  assert.strictEqual(vpcs[0].Properties.EnableDnsHostnames, false);
  assert.strictEqual(ofType('AWS::Route53Resolver::ResolverEndpoint').length, 0);
});

test('subnets are private', () => {
  const subnets = ofType('AWS::EC2::Subnet');
  assert.ok(subnets.length >= 2);
  for (const s of subnets) assert.strictEqual(s.Properties.MapPublicIpOnLaunch, false);
});

test('security group has no ingress and no 0.0.0.0/0 or ::/0 egress', () => {
  const sgs = ofType('AWS::EC2::SecurityGroup');
  assert.strictEqual(sgs.length, 1);
  const p = sgs[0].Properties;
  assert.deepStrictEqual(p.SecurityGroupIngress || [], []);
  assert.ok(Array.isArray(p.SecurityGroupEgress) && p.SecurityGroupEgress.length > 0, 'explicit egress removes the default allow-all');
  for (const e of p.SecurityGroupEgress) {
    assert.ok(!['0.0.0.0/0', '::/0'].includes(e.CidrIp || e.CidrIpv6), 'open egress');
    assert.strictEqual(e.CidrIp, '127.0.0.1/32');
  }
});

test('execution role: lambda trust, no managed policies, only ENI actions', () => {
  const [role] = ofType('AWS::IAM::Role');
  assert.strictEqual(ofType('AWS::IAM::Role').length, 1);
  assert.strictEqual(role.Properties.ManagedPolicyArns, undefined);
  const trust = role.Properties.AssumeRolePolicyDocument.Statement;
  assert.deepStrictEqual(trust.map((s) => s.Principal.Service), ['lambda.amazonaws.com']);
  const actions = role.Properties.Policies.flatMap((p) => p.PolicyDocument.Statement.flatMap((s) => [].concat(s.Action))).sort();
  assert.deepStrictEqual(actions, [
    'ec2:AssignPrivateIpAddresses', 'ec2:CreateNetworkInterface', 'ec2:DeleteNetworkInterface',
    'ec2:DescribeNetworkInterfaces', 'ec2:UnassignPrivateIpAddresses',
  ]);
  assert.strictEqual(ofType('AWS::IAM::Policy').length, 0);
  assert.strictEqual(ofType('AWS::IAM::ManagedPolicy').length, 0);
});

test('function: image, sized, VPC-attached, no environment', () => {
  const [fn] = ofType('AWS::Lambda::Function');
  const p = fn.Properties;
  assert.strictEqual(p.PackageType, 'Image');
  assert.strictEqual(p.MemorySize, 1024);
  assert.strictEqual(p.Timeout, 30);
  assert.strictEqual(p.EphemeralStorage.Size, 512);
  assert.ok(p.ReservedConcurrentExecutions);
  assert.strictEqual(p.Environment, undefined);
  assert.ok(p.VpcConfig.SubnetIds.length >= 2 && p.VpcConfig.SecurityGroupIds.length === 1);
  assert.strictEqual(template.Parameters.ReservedConcurrency.Default, 3);
  assert.ok(template.Outputs.FunctionArn);
});

test('image: pinned base, read-only code and execute-only interpreter (T53: Lambda denies prctl)', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /^FROM public\.ecr\.aws\/lambda\/python:3\.12@sha256:[0-9a-f]{64}$/m);
  assert.match(dockerfile, /chmod -R a-w \$\{LAMBDA_TASK_ROOT\}/);
  // Unreadable binary => the kernel marks every process exec'd from it non-dumpable.
  assert.match(dockerfile, /chmod 0711 \/var\/lang\/bin\/python3\.12\b/);
  const runs = dockerfile.replace(/\\\n/g, ' ').split('\n').filter((l) => /^RUN /.test(l));
  assert.match(runs[runs.length - 1], /chmod 0711/, 'no later RUN may need to read the interpreter');
});

test('backend invoke policy: only lambda:InvokeFunction on one non-wildcard ARN', () => {
  assert.strictEqual(policy.Statement.length, 1);
  const [s] = policy.Statement;
  assert.strictEqual(s.Effect, 'Allow');
  assert.deepStrictEqual([].concat(s.Action), ['lambda:InvokeFunction']);
  assert.strictEqual(typeof s.Resource, 'string');
  assert.ok(!s.Resource.includes('*'));
  assert.match(s.Resource, /^arn:aws:lambda:[^:]+:[^:]+:function:[A-Za-z0-9_-]+$/);
});
