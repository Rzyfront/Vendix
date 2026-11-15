// QUI-586 guard, no AWS needed: `node infra/ec2-iam/ec2-iam.test.cjs`.
// Pins that the backend deploy never writes long-lived IAM keys to the EC2 host
// and that the instance role policy only grants ECR pull.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..', '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-backend-ec2.yml'), 'utf8');
const policy = JSON.parse(fs.readFileSync(path.join(__dirname, 'ecr-pull-policy.json'), 'utf8'));

const deployStep = workflow.slice(workflow.indexOf('- name: Deploy to EC2 instance'));
const envBlock = deployStep.slice(0, deployStep.indexOf('run: |'));
const remote = deployStep.slice(deployStep.indexOf('<< ENDSSH'), deployStep.indexOf('\n        ENDSSH'));

const checks = [
  ['workflow never writes an access key id on the host', () =>
    assert.doesNotMatch(workflow, /aws configure set aws_access_key_id/)],
  ['workflow never writes a secret access key on the host', () =>
    assert.doesNotMatch(workflow, /aws configure set aws_secret_access_key/)],
  ['deploy step does not receive the IAM user keys', () => {
    assert.doesNotMatch(envBlock, /AWS_ACCESS_KEY_ID/);
    assert.doesNotMatch(envBlock, /AWS_SECRET_ACCESS_KEY/);
  }],
  ['remote script removes leftover static credentials before any AWS call', () => {
    const rm = remote.indexOf('rm -f ~/.aws/credentials');
    assert.ok(rm > -1, 'missing rm -f ~/.aws/credentials');
    assert.ok(rm < remote.indexOf('aws sts get-caller-identity'), 'credentials must be removed before the identity check');
  }],
  ['remote script requires the instance role before ECR login and before touching containers', () => {
    const sts = remote.indexOf('aws sts get-caller-identity');
    const assumedRole = remote.indexOf(':assumed-role/');
    const login = remote.indexOf('aws ecr get-login-password');
    const prune = remote.indexOf('docker container prune');
    assert.ok(sts > -1 && assumedRole > sts, 'missing assumed-role identity check');
    assert.ok(login > assumedRole, 'identity check must run before ECR login');
    assert.ok(prune > login, 'ECR login must run before any container cleanup');
  }],
  ['instance role policy grants only ECR pull actions', () => {
    const actions = policy.Statement.flatMap((s) => [].concat(s.Action)).sort();
    assert.deepStrictEqual(actions, [
      'ecr:BatchCheckLayerAvailability',
      'ecr:BatchGetImage',
      'ecr:GetAuthorizationToken',
      'ecr:GetDownloadUrlForLayer',
    ]);
    assert.ok(policy.Statement.every((s) => s.Effect === 'Allow'));
  }],
  ['pull actions are scoped to the vendix-backend repository', () => {
    for (const s of policy.Statement) {
      const actions = [].concat(s.Action);
      if (actions.includes('ecr:GetAuthorizationToken')) {
        assert.deepStrictEqual(actions, ['ecr:GetAuthorizationToken']);
        continue;
      }
      assert.strictEqual(s.Resource, 'arn:aws:ecr:us-east-1:637423209959:repository/vendix-backend');
    }
  }],
];

let failed = 0;
for (const [name, fn] of checks) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}\n     ${err.message.split('\n')[0]}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
