#!/usr/bin/env bash
# Offline structural checks only. No cloud calls, deployment, cfn-lint install or build.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
node <<'JS'
const assert=require('node:assert/strict');
const fs=require('node:fs');
const YAML=require('yaml');
function parse(file){const document=YAML.parseDocument(fs.readFileSync(file,'utf8'));assert.equal(document.errors.length,0,file+': '+document.errors);return document.toJS();}
const templateText=fs.readFileSync('infra/email-reception/receipt-rules.yaml','utf8');
assert(!/(?:^|\s)[&*][a-zA-Z][\w-]*(?:\s|$)/m.test(templateText),'CloudFormation does not support YAML anchors/aliases');
const t=parse('infra/email-reception/receipt-rules.yaml'),r=t.Resources;
assert.equal(t.AWSTemplateFormatVersion,'2010-09-09');
assert.deepEqual(t.Parameters.Environment.AllowedValues,['production','staging']);
assert.deepEqual(Object.keys(t.Mappings.SupportedRegion),['us-east-1']);
assert.equal(t.Mappings.Domains.production.Name,'recepcion.vendix.online');
assert.equal(t.Mappings.Domains.staging.Name,'recepcion-stg.vendix.online');
assert.equal(t.Parameters.ReceiptRuleEnabled.Default,'false');
assert(!Object.values(r).some(x=>x.Type==='AWS::SES::ReceiptRuleSet'));
const rule=r.ReceiptRule.Properties;
assert.deepEqual(rule.RuleSetName,{Ref:'ReceiptRuleSetName'});
assert.equal(rule.Rule.ScanEnabled,true);
assert.equal(rule.Rule.Actions[0].S3Action.ObjectKeyPrefix,'raw/');
assert.equal(rule.Rule.Actions[0].S3Action.KmsKeyArn,undefined);
assert.deepEqual(rule.Rule.Actions[1],{StopAction:{Scope:'RuleSet'}});
for(const queue of ['InboundQueue','DeadLetterQueue']){
 assert.equal(r[queue].Properties.MessageRetentionPeriod,1209600);
 assert.equal(r[queue].Properties.SqsManagedSseEnabled,true);
 assert.equal(r[queue].DeletionPolicy,'Retain');
}
assert.equal(r.InboundQueue.Properties.ReceiveMessageWaitTimeSeconds,20);
assert.equal(r.InboundQueue.Properties.VisibilityTimeout,120);
assert.equal(r.InboundQueue.Properties.RedrivePolicy.maxReceiveCount,5);
assert.equal(r.DeadLetterQueue.Properties.RedriveAllowPolicy.redrivePermission,'byQueue');
assert.equal(r.ReceiptSubscription.Properties.RawMessageDelivery,false);
assert.equal(r.InboundBucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm,'AES256');
assert(Object.values(r.InboundBucket.Properties.PublicAccessBlockConfiguration).every(x=>x===true));
const lifecycle=r.InboundBucket.Properties.LifecycleConfiguration.Rules;
assert(lifecycle.every(x=>x.Prefix==='raw/'));
assert.deepEqual(lifecycle.map(x=>x.ExpirationInDays),[30,7,7]);
assert.equal(lifecycle[1].TagFilters[0].Value,'non-invoice');
assert.equal(lifecycle[2].TagFilters[0].Value,'spam');
const backend=r.BackendPolicy.Properties.PolicyDocument.Statement;
assert(!JSON.stringify(backend).includes('StartMessageMoveTask'));
assert(!JSON.stringify(backend).includes('DeleteObject'));
assert(backend.some(x=>x.Resource?.Ref==='OriginalObjectArn'));
assert(r.OperatorRedrivePolicy.Properties.PolicyDocument.Statement.some(x=>x.Action.includes('sqs:StartMessageMoveTask')));
for(const policy of ['InboundBucketPolicy','ReceiptTopicPolicy']){
 const allow=r[policy].Properties.PolicyDocument.Statement.find(x=>x.Effect==='Allow');
 assert(allow.Condition.StringEquals['AWS:SourceAccount']);
 assert(allow.Condition.ArnEquals['AWS:SourceArn']);
}
assert(r.QueuePolicy.Properties.PolicyDocument.Statement.some(x=>x.Sid==='DenyUnapprovedSender'&&x.Effect==='Deny'));
assert.equal(Object.values(r).filter(x=>x.Type==='AWS::CloudWatch::Alarm').length,7);
assert(r.MonthlyBudget&&r.OperationsSubscription);
// Resolve Ref/GetAtt/Sub resource dependencies; reject missing IDs and cycles offline.
const ids=new Set(Object.keys(r)),params=new Set(Object.keys(t.Parameters));
function deps(v,set){
 if(!v||typeof v!=='object')return;
 if(Array.isArray(v)){v.forEach(x=>deps(x,set));return;}
 if(v.Ref){assert(ids.has(v.Ref)||params.has(v.Ref)||v.Ref.startsWith('AWS::'),'Unknown Ref '+v.Ref);if(ids.has(v.Ref))set.add(v.Ref);}
 if(v['Fn::GetAtt']){const id=Array.isArray(v['Fn::GetAtt'])?v['Fn::GetAtt'][0]:v['Fn::GetAtt'].split('.')[0];assert(ids.has(id),'Unknown GetAtt '+id);set.add(id);}
 if(v['Fn::Sub']){const str=Array.isArray(v['Fn::Sub'])?v['Fn::Sub'][0]:v['Fn::Sub'];for(const match of str.matchAll(/\$\{([^!}]+)\}/g)){const id=match[1].split('.')[0];assert(ids.has(id)||params.has(id)||id.startsWith('AWS::'),'Unknown Sub '+id);if(ids.has(id))set.add(id);}}
 Object.values(v).forEach(x=>deps(x,set));
}
const graph={};for(const[id,value]of Object.entries(r)){const set=new Set();deps(value.Properties,set);for(const d of [].concat(value.DependsOn||[])){assert(ids.has(d));set.add(d);}graph[id]=[...set];}
const done=new Set(),visiting=new Set();function visit(id){if(done.has(id))return;assert(!visiting.has(id),'Circular resource dependency '+id);visiting.add(id);graph[id].forEach(visit);visiting.delete(id);done.add(id);}Object.keys(graph).forEach(visit);
const w=parse('.github/workflows/deploy-backend-ec2.yml');
const deploy=w.jobs.deploy.steps.find(x=>x.name==='Deploy to EC2 instance').run;
for(const key of ['ENABLED','STORE_ALLOWLIST','ENVIRONMENT','DOMAIN','AWS_REGION','SQS_QUEUE_URL','SNS_TOPIC_ARN','RAW_BUCKET','RAW_PREFIX','DIAN_STATUS_ENABLED']){
 const name='EMAIL_RECEPTION_'+key;
 assert.equal(deploy.split('-e '+name+'=').length-1,2,name+' must flow to API and worker');
}
assert(deploy.includes("data.get('EMAIL_RECEPTION_ENABLED', 'false')"));
assert(deploy.includes('allkeys-lru'),'Existing Redis policy must remain untouched');
assert(!deploy.includes('crontab'),'No premature retention cron installation');
console.log('PASS offline IaC/workflow: YAML, existing ruleset only, region/domains, disabled defaults, S3/SNS/SQS/DLQ, scoped IAM/lifecycle, 7 alarms/budget, references/no cycles, API+worker env. NOT AWS service validation or live delivery.');
JS
bash -n infra/email-reception/prepare-change-set.sh
bash -n infra/email-reception/validate-template.sh
