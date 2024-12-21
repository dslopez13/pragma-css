import { Construct } from "constructs";
import { aws_kinesis as kinesis } from "aws-cdk-lib";
import { Bucket } from "aws-cdk-lib/aws-s3";
import {
  DequeuingProcessConfig,
  FastDataFlows,
  FirehoseConfig,
  KinesisFirehoseConfig,
  LambdaConfig,
  OnErrorDequeuing,
  SnsConfig,
  SqsConfig,
} from "../../utils/helpers";
import { SQSConstruct } from "../sqs/sqs-constructor";
import { IQueue } from "aws-cdk-lib/aws-sqs";
import { SNSConstruct } from "../sns/sns-constructor";
import {
  Effect,
  ManagedPolicy,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { LambdaConstruct } from "../lambda/lambda-constructor";
import { IStream } from "aws-cdk-lib/aws-kinesis";
import { Constants } from "../../utils/constants";
import { KinesisFirehoseConstruct } from "../kinesis/kinesis-firehose-construct";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { IVpc, SecurityGroup } from "aws-cdk-lib/aws-ec2";

export interface FlowKDS2Lambda2SNSProps {
  readonly kinesisDataStreamSource: kinesis.Stream;
  readonly prjName: string;
  readonly bucketDestination: Bucket;
  readonly config: FastDataFlows;
  readonly secret: Secret;
  readonly vpc: IVpc;
  readonly sgLambda: SecurityGroup;
  readonly elasticEndpoint: string;
}

export class FlowKDS2Lambda2SNS extends Construct {
  public kinesisFirehoseArn: string;
  public sqsArns: string[] = [];
  public sqsdlqArns: string[] = [];
  public lambdaNames: string[] = [];
  private snsArns: string[] = [];
  private configSNS: SnsConfig[];
  private configLambda: LambdaConfig;
  private configDequeuingProcess: DequeuingProcessConfig[];
  private configOnErrorDequeuingProcess: OnErrorDequeuing;
  private prjName: string;
  private flowType: number;
  private flowName: string;
  private bucketDestination: Bucket;
  private secret: Secret;
  private vpc: IVpc;
  private sgLambda: SecurityGroup;
  private elasticEndpoint: string;

  constructor(scope: Construct, id: string, props: FlowKDS2Lambda2SNSProps) {
    super(scope, id);
    this.validations(props.config);
    this.setVars(props);

    this.createSQS(props.config.kinesisDataStreamQueuing!.sqsConfig);
    this.createSNS(props.prjName);
    let firehoseObj = this.createDestinationConfig(props.config.firehoseConfig);

    let lambdaNameQueuing = this.createLambdaQueuing(
      this.configLambda,
      props.prjName,
      props.kinesisDataStreamSource
    );
    let lambdaNamesDequeuing = this.createDequeuingProcess(
      this.configDequeuingProcess,
      firehoseObj.firehoseName,
      firehoseObj.firehoseArn
    );
    let lambdaNameOnError = this.createOnErrorDequeuingProcess(
      this.configOnErrorDequeuingProcess,
      firehoseObj.firehoseName,
      firehoseObj.firehoseArn
    );

    this.lambdaNames.push(
      lambdaNameQueuing,
      lambdaNameOnError,
      ...lambdaNamesDequeuing
    );
  }

  setVars(props: FlowKDS2Lambda2SNSProps) {
    this.prjName = props.prjName;
    this.flowName = props.config.name;
    this.flowType = props.config.flowType;
    this.configSNS = props.config.kinesisDataStreamQueuing!.snsConfig;
    this.configLambda = props.config.kinesisDataStreamQueuing!.lambdaConfig;
    this.secret = props.secret;
    this.bucketDestination = props.bucketDestination;
    this.vpc = props.vpc;
    this.sgLambda = props.sgLambda;
    this.elasticEndpoint = props.elasticEndpoint;
    if (props.config.dequeuingProcessConfig != undefined) {
      this.configDequeuingProcess = props.config.dequeuingProcessConfig;
    }
    if (props.config.onErrorDequeuing != undefined) {
      this.configOnErrorDequeuingProcess = props.config.onErrorDequeuing;
    }
  }

  createDestinationConfig(destinationConfig: FirehoseConfig) {
    let firehoseObj = this.createFirehose(
      destinationConfig.kinesisFirehoseConfig,
      destinationConfig.bucketDestination.name
    );
    return firehoseObj;
  }

  createOnErrorDequeuingProcess(
    onErrorDequeuing: OnErrorDequeuing,
    firehoseName: string,
    firehoseARN: string
  ) {
    let lambdaName = `fn-${this.prjName}-${onErrorDequeuing.lambdaConfig.name}`;
    let firehoseArn: string = "";
    let secretArn: string = "";
    if (onErrorDequeuing.type == Constants.DEQUEUING_TYPE_LAMBDA) {
      onErrorDequeuing.lambdaConfig.env.forEach((env) => {
        if (env.key == Constants.SECRET_ACCESS_ENV_KEY) {
          secretArn = this.secret.secretArn;
        }
        if (env.key == Constants.FIREHOSE_ACCESS_ENV_KEY) {
          env.value = firehoseName;
          firehoseArn = firehoseARN;
        }
      });
      let dlqArns: string[] = [];
      this.sqsdlqArns.forEach((sqs) => {
        let sqssplit = sqs.split(":");
        dlqArns.push(sqssplit[1]);
      });
      let role = this.createRoleLambda(lambdaName, {
        secretArn,
        firehoseArn,
        sqsdqlArns: dlqArns,
        dlqArn: this.sqsArns,
      });
      this.createLambdaOnError(
        onErrorDequeuing.lambdaConfig,
        role,
        this.prjName
      );
    }
    return lambdaName;
  }

  createDequeuingProcess(
    dequeuingProcessConfig: DequeuingProcessConfig[],
    firehoseName: string,
    firehoseARN: string
  ) {
    let lambdaNames: string[] = [];
    dequeuingProcessConfig.forEach((config) => {
      let lambdaName = `fn-${this.prjName}-${config.lambdaConfig.name}`;
      let firehoseArn: string = "";
      let secretArn: string = "";
      let dqlArn: string[] = [];
      if (config.type == Constants.DEQUEUING_TYPE_LAMBDA) {
        config.lambdaConfig.env.forEach((env) => {
          if (env.key == Constants.SECRET_ACCESS_ENV_KEY) {
            secretArn = this.secret.secretArn;
          }
          if (env.key == Constants.FIREHOSE_ACCESS_ENV_KEY) {
            env.value = firehoseName;
            firehoseArn = firehoseARN;
          }
        });
        config.lambdaConfig.triggersConfig?.forEach((trigger) => {
          this.sqsdlqArns.forEach((sqs) => {
            let sqsSplit = sqs.split(":");
            if (trigger.sqsTriggerConfig?.nameResource == sqsSplit[0]) {
              dqlArn.push(sqsSplit[1]);
            }
          });
        });

        let role = this.createRoleLambda(lambdaName, {
          firehoseArn,
          secretArn,
          dlqArn: dqlArn,
        });
        this.createLambdaDequeuing(config.lambdaConfig, role, this.prjName);
        lambdaNames.push(lambdaName);
      }
    });
    return lambdaNames;
  }

  createFirehose(
    kinesisFirehoseConfig: KinesisFirehoseConfig,
    bucketName: string
  ) {
    let kinesisFirehoseName = `PUT-queuing-2S3-${bucketName}`;
    kinesisFirehoseName = kinesisFirehoseName.slice(0, 60);
    let firehoseConstruct = new KinesisFirehoseConstruct(
      this,
      `${this.prjName}-kinesisfirehose-${this.flowName}`,
      {
        kinesisFireHoseName: kinesisFirehoseName,
        kinesisFirehoseDeliveryType: "DirectPut",
        bucketDestination: this.bucketDestination,
        kinesisFirehoseConfig: kinesisFirehoseConfig,
        flowType: this.flowType,
      }
    );
    return {
      firehoseName: kinesisFirehoseName,
      firehoseArn: firehoseConstruct.kinesisFirehoseArn,
    };
  }

  setVpcIfRequired(lambdaConfig: LambdaConfig) {
    if (lambdaConfig.vpcAccess) {
      lambdaConfig.vpc = this.vpc;
    }
  }

  createLambdaDequeuing(
    lambdaConfig: LambdaConfig,
    role: Role,
    prjName: string
  ) {
    this.setVpcIfRequired(lambdaConfig);
    new LambdaConstruct(this, `${lambdaConfig.name}-queuing-construct`, {
      lambdaConfig,
      role,
      prjName,
      sgLambda: this.sgLambda,
      elasticEndpoint: this.elasticEndpoint,
    });
  }

  createLambdaOnError(lambdaConfig: LambdaConfig, role: Role, prjName: string) {
    this.setVpcIfRequired(lambdaConfig);
    let lambdaConstruct = new LambdaConstruct(
      this,
      `${lambdaConfig.name}-onerror-construct`,
      {
        lambdaConfig,
        role,
        prjName,
        sgLambda: this.sgLambda,
        elasticEndpoint: this.elasticEndpoint,
      }
    );
    return lambdaConstruct.lambdaName;
  }

  createLambdaQueuing(
    lambdaConfig: LambdaConfig,
    prjName: string,
    stream: IStream
  ) {
    this.setVpcIfRequired(lambdaConfig);
    let lambdaName = `fn-${this.prjName}-${lambdaConfig.name}`;
    let dlqArns: string[] = [];
    this.sqsdlqArns.forEach((sqs) => {
      let sqssplit = sqs.split(":");
      dlqArns.push(sqssplit[1]);
    });
    let roleExecutionLambda = this.createRoleLambda(lambdaName, {
      streamArn: stream.streamArn,
      snsArns: this.snsArns,
      dlqArn: dlqArns,
    });
    new LambdaConstruct(this, `${lambdaConfig.name}-queuing-construct`, {
      lambdaConfig,
      role: roleExecutionLambda,
      prjName,
      kinesisDataStream: stream,
      sgLambda: this.sgLambda,
      elasticEndpoint: this.elasticEndpoint,
    });

    return lambdaName;
  }

  createRoleLambda(
    lambdaName: string,
    options: {
      firehoseArn?: string;
      secretArn?: string;
      dlqArn?: string[];
      streamArn?: string;
      sqsdqlArns?: string[];
      snsArns?: string[];
    }
  ) {
    let role = new Role(this, `${lambdaName}-access-role`, {
      assumedBy: new ServicePrincipal(`lambda.amazonaws.com`),
      inlinePolicies: {
        cloudWatchPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
                "ec2:CreateNetworkInterface",
                "ec2:DescribeNetworkInterfaces",
                "ec2:DeleteNetworkInterface",
                "ec2:AssignPrivateIpAddresses",
                "ec2:UnassignPrivateIpAddresses",
              ],
              resources: [`*`],
            }),
          ],
        }),
      },
    });

    if (options.firehoseArn) {
      const firehosePolicy = new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["firehose:PutRecord", "firehose:PutRecordBatch"],
        resources: [options.firehoseArn],
      });
      role.addToPolicy(firehosePolicy);
    }

    if (options.secretArn) {
      const secretPolicy = new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["secretsmanager:GetSecretValue"],
        resources: [options.secretArn],
      });
      role.addToPolicy(secretPolicy);
    }

    if (options.dlqArn) {
      const dlqPolicy = new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["sqs:SendMessage"],
        resources: options.dlqArn,
      });
      role.addToPolicy(dlqPolicy);
    }

    if (options.streamArn) {
      const kinesisPolicy = new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "kinesis:ListShards",
          "kinesis:GetRecords",
          "kinesis:DescribeStream",
          "kinesis:GetShardIterator",
          "kinesis:DescribeStreamSummary",
          "kinesis:ListStreams",
          "kinesis:SubscribeToShard",
        ],
        resources: [options.streamArn],
      });
      role.addToPolicy(kinesisPolicy);
    }

    if (options.sqsdqlArns) {
      const sqsPolicy = new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "sqs:ListQueues",
          "sqs:ChangeMessageVisibility",
          "sqs:GetQueueUrl",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ReceiveMessage",
        ],
        resources: options.sqsdqlArns,
      });
      role.addToPolicy(sqsPolicy);
    }

    if (options.snsArns) {
      const snsPolicy = new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["sns:Publish"],
        resources: options.snsArns,
      });
      role.addToPolicy(snsPolicy);
    }

    return role;
  }

  createSNS(prjName: string) {
    for (let i = 0; i < this.configSNS.length; i++) {
      let snsConstructor = new SNSConstruct(
        this,
        `${this.configSNS[i].name}-construct`,
        {
          nameSNS: this.configSNS[i].name,
          fifo: this.configSNS[i].fifo ?? false,
          suscriptions: this.configSNS[i].suscriptions,
          prjName: prjName,
        }
      );
      this.snsArns.push(snsConstructor.SNSArn);
      let snsArnKey = `${this.configSNS[i].name
        .toUpperCase()
        .replace(/-/g, "_")}_ARN`;
      this.setEnvToLambda(snsArnKey, snsConstructor.SNSArn);
    }
  }

  setEnvToLambda(resourceName: string, resourceArn: string) {
    this.configLambda.env.forEach((env) => {
      if (env.key == resourceName) {
        env.value = resourceArn;
      }
    });
  }

  setSQSToSuscription(sqsName: string, queue: IQueue) {
    this.configSNS.forEach((snsConfig) => {
      snsConfig.suscriptions.forEach((subscription) => {
        if (subscription.name === sqsName) {
          subscription.queue = queue;
        }
      });
    });
  }
  setSQSToDequeuing(sqsName: string, queue: IQueue) {
    this.configDequeuingProcess.forEach((config) => {
      config.lambdaConfig.triggersConfig?.forEach((triggerConfig) => {
        if (triggerConfig.sqsTriggerConfig!.nameResource == sqsName) {
          triggerConfig.sqsTriggerConfig!.queue = queue;
        }
      });
    });
  }
  setEnvToQueuingLambda(resourceName: string, resourceValue: string) {
    let result = false;
    this.configLambda.env.forEach((env) => {
      if (env.key == resourceName) {
        env.value = resourceValue;
        result = true;
      }
    });
    return result;
  }
  setEnvToDequeuing(resourceName: string, resourceValue: string) {
    let result = false;
    this.configDequeuingProcess.forEach((config) => {
      config.lambdaConfig.env.forEach((env) => {
        if (env.key == resourceName) {
          env.value = resourceValue;
          result = true;
        }
      });
    });
    return result;
  }
  setEnvToOnErrorLambda(resourceName: string, resourceValue: string) {
    let result = false;
    this.configOnErrorDequeuingProcess.lambdaConfig.env.forEach((env) => {
      if (env.key == resourceName) {
        env.value = resourceValue;
        result = true;
      }
    });
    return result;
  }

  createSQS(sqsConfig: SqsConfig[]) {
    for (let i = 0; i < sqsConfig.length; i++) {
      let sqsConstruct = new SQSConstruct(
        this,
        `${sqsConfig[i].name}-construct`,
        {
          nameSqs: sqsConfig[i].name,
          dql: sqsConfig[i].dlq,
          prjName: this.prjName,
        }
      );
      let sqsDqlUrlKey = `${sqsConfig[i].name
        .toUpperCase()
        .replace(/-/g, "_")}_DLQ_URL`;
      let sqsMainUrlKey = `${sqsConfig[i].name
        .toUpperCase()
        .replace(/-/g, "_")}_MAIN_URL`;
      this.sqsdlqArns.push(`${sqsConfig[i].name}:${sqsConstruct.sqsDqlArn}`);
      this.sqsArns.push(sqsConstruct.sqsArn);
      this.setSQSToSuscription(sqsConfig[i].name, sqsConstruct.IQueue);
      this.setSQSToDequeuing(sqsConfig[i].name, sqsConstruct.IQueue);
      this.setEnvToLambda(sqsDqlUrlKey, sqsConstruct.dlqUrl);
      this.setEnvToDequeuing(sqsDqlUrlKey, sqsConstruct.dlqUrl);
      this.setEnvToOnErrorLambda(sqsDqlUrlKey, sqsConstruct.dlqUrl);
      this.setEnvToQueuingLambda(sqsDqlUrlKey, sqsConstruct.dlqUrl);
      this.setEnvToOnErrorLambda(sqsMainUrlKey, sqsConstruct.IQueue.queueUrl);
    }
  }

  validations(config: FastDataFlows) {
    if (config.kinesisDataStreamQueuing == undefined) {
      throw Error("Object KinesisDataStreamQueuing must be");
    }
    if (config.dequeuingProcessConfig == undefined) {
      throw Error("Object dequeuingProcessConfig must be");
    }

    if (config.kinesisDataStreamQueuing.snsConfig.length == 0) {
      throw Error("Least sns object must be on kinesisDataStreamQueuing");
    }
    if (config.kinesisDataStreamQueuing.sqsConfig.length == 0) {
      throw Error("Least sqs object must be on kinesisDataStreamQueuing");
    }
  }
}
