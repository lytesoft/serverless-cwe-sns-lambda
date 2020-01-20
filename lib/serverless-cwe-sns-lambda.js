"use strict";

/**
 * Converts a string from camelCase to PascalCase. Basically, it just
 * capitalises the first letter.
 *
 * @param {string} camelCase camelCase string
 */
const pascalCase = camelCase => camelCase.slice(0, 1).toUpperCase() + camelCase.slice(1);

module.exports = class ServerlessCweSnsLambda {
    constructor(serverless, options) {
        this.serverless = serverless;
        this.options = options;
        this.provider = serverless ? serverless.getProvider("aws") : null;
        this.custom = serverless.service ? serverless.service.custom : null;
        this.serviceName = serverless.service.service;

        if (!this.provider) {
            throw new Error("This plugin must be used with AWS");
        }

        this.hooks = {
            "aws:package:finalize:mergeCustomProviderResources": this.modifyTemplate.bind(this)
        };
    }

    /**
     * Mutate the CloudFormation template, adding the necessary resources for
     * the Lambda to subscribe to the SNS topics with error handling sqs attached
     * functionality built in.
     */
    modifyTemplate() {
        const functions = this.serverless.service.functions;
        const stage = this.serverless.service.provider.stage;
        const template = this.serverless.service.provider.compiledCloudFormationTemplate;

        Object.keys(functions).forEach(funcKey => {
            const func = functions[funcKey];
            if (func.events) {
                func.events.forEach(event => {
                    if (event.cweSns) {
                        if (this.options.verbose) {
                            console.info(
                                `Adding cweSns event handler [${JSON.stringify(event.cweSns)}]`
                            );
                        }
                        this.addCweSnsResources(template, funcKey, stage, event.cweSns);
                    }
                });
            }
        });
    }

    /**
     * Validate the configuration values from the serverless config file,
     * returning a config object that can be passed to the resource setup
     * functions.
     *
     * @param {string} funcName the name of the function from serverless config
     * @param {string} stage the stage name from the serverless config
     * @param {object} config the configuration values from the cweSns event
     *  portion of the serverless function config
     */
    validateConfig(funcName, stage, config) {
        if (!config.topicResourceName || !config.ruleResourceName) {
            throw new Error(`Error:
              When creating an cweSns handler, you must define the rule name and topic name.
              In function [${funcName}]

              Usage
              -----

                functions:
                  processEvent:
                    handler: handler.handler
                    events:
                      - cweSns:
                          ruleResourceName: string                              #required
                          topicResourceName: string                             #optional
                          dlqResourceName:  string                              #optional
                          dlqPolicyResourceName : string                        #optional
                          ruleMessage: Input || InputPath || InputTransformer   #optional                         
                          filterPolicy: Object                                  #optional
                          prefix: string                                        #optional
              `);
        }

        const funcNamePascalCase = pascalCase(funcName);

        return {
            ...config,
            funcName: funcNamePascalCase,
            prefix: config.prefix || `${this.serviceName}-${stage}-`,
            topicResourceName:
                config.topicResourceName ||
                `${config.ruleResourceName}To${funcNamePascalCase}Topic`,
            topicPolicyResourceName: config.topicPolicyResourceName || "CWEtoSNSInsertPolicy",
            dlqResourceName: config.dlqResourceName || "SNSDeadLetterQueue",
            dlqPolicyResourceName: config.dlqPolicyResourceName || "SNStoDLQInsertPolicy",
            ruleMessage: config.ruleMessage || {},
            filterPolicy: config.filterPolicy || {}
        };
    }

    /**
     *
     * @param {object} template the template which gets mutated
     * @param {string} funcName the name of the function from serverless config
     * @param {string} stage the stage name from the serverless config
     * @param {object} cweSnsConfig the configuration values from the cweSns
     *  event portion of the serverless function config
     */
    addCweSnsResources(template, funcName, stage, cweSnsConfig) {
        const config = this.validateConfig(funcName, stage, cweSnsConfig);
        [
            this.addSNSTopic,
            this.addSNSDLQ,
            this.addCWEtoSNSPolicy,
            this.addSNStoDLQPolicy,
            this.addTopicToCloudWatchRule,
            this.addTopicSubscription,
            this.addEventInvocationPermission
        ].reduce((templ, func) => {
            func(templ, config);
            return templ;
        }, template);
    }

    addSNSTopic(template, {prefix, topicResourceName}) {
        template.Resources[`${topicResourceName}`] = {
            Type: "AWS::SNS::Topic",
            Properties: {
                TopicName: `${prefix}${topicResourceName}`
            }
        };
    }

    addSNSDLQ(template, {prefix, dlqResourceName}) {
        if (!template.Resources[dlqResourceName]) {
            template.Resources[dlqResourceName] = {
                Type: "AWS::SQS::Queue",
                Properties: {
                    QueueName: `${prefix}${dlqResourceName}`,
                    MessageRetentionPeriod: 1209600 //14 days in seconds
                }
            };
        }
    }

    addTopicToCloudWatchRule(template, {topicResourceName, ruleResourceName, ruleMessage}) {
        if (
            !template.Resources[ruleResourceName] ||
            !template.Resources[ruleResourceName].Properties ||
            !template.Resources[ruleResourceName].Properties.Targets
        ) {
            throw new Error(
                `Invalid resource ${ruleResourceName} for a cwe rule. The resource must be defined and contain Properties and Targets`
            );
        } else if (template.Resources[ruleResourceName].Properties.Targets.length === 5) {
            throw new Error(`Maximum of 5 targets reached for ${ruleResourceName} rule`);
        } else {
            template.Resources[ruleResourceName].Properties.Targets.push({
                Arn: {
                    Ref: topicResourceName
                },
                Id: topicResourceName,
                ...ruleMessage
            });
        }
    }

    addSNStoDLQPolicy(
        template,
        {prefix, topicResourceName, dlqResourceName, dlqPolicyResourceName}
    ) {
        if (!template.Resources[dlqPolicyResourceName]) {
            template.Resources[dlqPolicyResourceName] = {
                Type: "AWS::SQS::QueuePolicy",
                Properties: {
                    PolicyDocument: {
                        Version: "2012-10-17",
                        Id: `${prefix}${dlqPolicyResourceName}`,
                        Statement: []
                    },
                    Queues: []
                }
            };
        }
        template.Resources[dlqPolicyResourceName].Properties.Queues.push({
            Ref: dlqResourceName
        });
        template.Resources[dlqPolicyResourceName].Properties.PolicyDocument.Statement.push({
            Effect: "Allow",
            Principal: {
                Service: "sns.amazonaws.com"
            },
            Action: "sqs:SendMessage",
            Resource: {"Fn::GetAtt": [dlqResourceName, "Arn"]},
            Condition: {
                ArnEquals: {
                    "aws:SourceArn": {Ref: topicResourceName}
                }
            }
        });
    }

    addCWEtoSNSPolicy(template, {prefix, topicResourceName, topicPolicyResourceName}) {
        if (!template.Resources[topicPolicyResourceName]) {
            template.Resources[topicPolicyResourceName] = {
                Type: "AWS::SNS::TopicPolicy",
                Properties: {
                    PolicyDocument: {
                        Version: "2012-10-17",
                        Id: `${prefix}CWEtoSNSInsertPolicy`,
                        Statement: []
                    },
                    Topics: []
                }
            };
        }
        template.Resources[topicPolicyResourceName].Properties.Topics.push({
            Ref: topicResourceName
        });
        template.Resources[topicPolicyResourceName].Properties.PolicyDocument.Statement.push({
            Effect: "Allow",
            Principal: {
                Service: ["events.amazonaws.com"]
            },
            Action: ["sns:Publish"],
            Resource: {Ref: topicResourceName}
        });
    }

    addTopicSubscription(template, {funcName, topicResourceName, dlqResourceName, filterPolicy}) {
        template.Resources[`SubscribeTo${topicResourceName}Topic`] = {
            Type: "AWS::SNS::Subscription",
            Properties: {
                TopicArn: {Ref: topicResourceName},
                Endpoint: {
                    "Fn::GetAtt": [`${funcName}LambdaFunction`, "Arn"]
                },
                Protocol: "lambda",
                RedrivePolicy: {
                    deadLetterTargetArn: {"Fn::GetAtt": [dlqResourceName, "Arn"]}
                },
                FilterPolicy: filterPolicy
            }
        };
    }

    addEventInvocationPermission(template, {funcName, topicResourceName}) {
        template.Resources[`${funcName}InvokeFrom${topicResourceName}`] = {
            Type: "AWS::Lambda::Permission",
            Properties: {
                FunctionName: {
                    "Fn::GetAtt": [`${funcName}LambdaFunction`, "Arn"]
                },
                Action: "lambda:InvokeFunction",
                Principal: "sns.amazonaws.com",
                SourceArn: {Ref: topicResourceName}
            }
        };
    }
};
