import { CfnTopicRule } from "aws-cdk-lib/aws-iot";
import { Construct } from "constructs";
import {
    IoTCoreConfig,
  IotCoreRulesConfig,
  IotCoreRulesConfigDestination,
} from "../../utils/helpers";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Stack } from "aws-cdk-lib";

export interface IoTCoreProps {
  prjName: string;
  iotCoreConfig: IoTCoreConfig;
}

export class IoTCoreConstruct extends Construct {
  private prjName: string;
  constructor(scope: Construct, id: string, props: IoTCoreProps) {
    super(scope, id);

    props.iotCoreConfig.rulesConfig.forEach((rule)=>{
        const actions = this.createActions(rule.actions);
        const iotRule = new CfnTopicRule(this, `${this.prjName}-iot-${rule.name}`, {
          ruleName: rule.name,
          topicRulePayload: {
            sql: rule.query,
            actions: actions,
          },
        });

    })
  }

  createActions(destinations: IotCoreRulesConfigDestination[]): any[] {
    console.log(destinations)
    return destinations.map((destination) => {
      if (destination.type === "kinesis") {
        const role = this.createIoTRoleForKinesis(destination.name);
        return {
          kinesis: {
            roleArn: role.roleArn,
            streamName: destination.name,
            partitionKey: destination.kinesisPartitionKey || "${topic()}",
          },
        };
      } else if (destination.type === "cloudwatchlogs") {
        const role = this.createIoTRoleForCloudWatchLogs(destination.name);
        return {
          cloudwatchLogs: {
            roleArn: role.roleArn,
            logGroupName: destination.name,
          },
        };
      } else {
        throw new Error(`Unsupported destination type: ${destination.type}`);
      }
    });
  }

  private createIoTRoleForKinesis(streamName: string): Role {
    const role = new Role(this, `IoTRoleForKinesis-${streamName}`, {
      assumedBy: new ServicePrincipal('iot.amazonaws.com'),
    });

    role.addToPolicy(
      new PolicyStatement({
        actions: ['kinesis:PutRecord', 'kinesis:PutRecords'],
        resources: [`arn:aws:kinesis:${Stack.of(this).region}:${Stack.of(this).account}:stream/${streamName}`],
      })
    );

    return role;
  }

  private createIoTRoleForCloudWatchLogs(logGroupName: string): Role {
    const role = new Role(this, `IoTRoleForCloudWatchLogs-${logGroupName}`, {
      assumedBy: new ServicePrincipal('iot.amazonaws.com'),
    });

    role.addToPolicy(
      new PolicyStatement({
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [`arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:${logGroupName}:*`],
      })
    );

    return role;
  }
}
