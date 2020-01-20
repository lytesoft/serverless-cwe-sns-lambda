# Serverless Cwe Sns Sqs Lambda

[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com) [![MIT License](http://img.shields.io/badge/license-MIT-blue.svg?style=flat)](LICENSE) 

This plugin allows to define a cloudwatch event rule as the trigger for a lambda. To handle errors and retries, this event will go through SNS (connected to a DLQ to avoid delivery problems) and call a lambda which should have the onError param with another DLQ defined (outside the scope of this plugin)

## Install

Run `npm install` in your Serverless project.

`$ npm install --save-dev https://github.com/tcastelli/serverless-cwe-sns-lambda/master/tarball`

Add the plugin to your serverless.yml file

```yml
plugins:
  - "serverless-cwe-sns-lambda"
```

## Setup


```yml
functions:
  processEvent:
    handler: handler.handler
    events:
      - cweSns:
          ruleResourceName: XXXXEvent                           #required
          topicResourceName: XXXXTopic                          #optional
          dlqResourceName:  string                              #optional
          dlqPolicyResourceName : string                        #optional
          ruleMessage: Input || InputPath || InputTransformer   #optional                         
          filterPolicy: Object                                  #optional
          prefix: string                                        #optional

resources:
  Resources:
    XXXXEvent:
      Type: AWS::Events::Rule
      Properties:
        ScheduleExpression: cron(0/3 * * * ? *)
        State: ENABLED
        Targets: []

plugins:
  - serverless-cwe-sns-lambda
```
