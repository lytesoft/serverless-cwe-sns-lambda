# Serverless Cwe Sns Sqs Lambda

[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com) [![MIT License](http://img.shields.io/badge/license-MIT-blue.svg?style=flat)](LICENSE) 

This plugin allows to define a cloudwatch event rule as the trigger for a lambda. To handle errors and retries, this event will go through SNS (connected to a DLQ to avoid delivery problems) and will have another DLQ connected to the final lambda function.

## Install

Run `npm install` in your Serverless project.

`$ npm install --save-dev @agiledigital/serverless-sns-sqs-lambda`

Add the plugin to your serverless.yml file

```yml
plugins:
  - "@agiledigital/serverless-sns-sqs-lambda"
```

## Setup

WIP

```yml
functions:
  processEvent:
    handler: handler.handler
    events:
      - cwe-sns-sqs:
          name: TestEvent # Required - choose a name prefix for the event queue
          topicArn: !Ref Topic # Required - SNS topic to subscribe to
          batchSize: 2 # Optional - default value is 10
          maxRetryCount: 2 # Optional - default value is 5
          filterPolicy: # Optional - filter messages that are handled
            pets:
              - dog
              - cat

resources:
  Resources:
    Topic:
      Type: AWS::SNS::Topic
      Properties:
        TopicName: TestTopic

plugins:
  - serverless-sns-sqs-lambda
```
