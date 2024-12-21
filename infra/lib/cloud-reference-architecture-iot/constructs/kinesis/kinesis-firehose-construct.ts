import {
  CfnDeliveryStream,
  CfnDeliveryStreamProps,
} from "aws-cdk-lib/aws-kinesisfirehose";
import { Construct } from "constructs";
import { aws_kinesis as kinesis } from "aws-cdk-lib";
import { Key } from "aws-cdk-lib/aws-kms";
import { Bucket } from "aws-cdk-lib/aws-s3";
import {
  Effect,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { KinesisFirehoseConfig } from "../../utils/helpers";

export interface KinesisFirehoseConstructProps {
  readonly kinesisDataStream?: kinesis.Stream;
  readonly kinesisFireHoseName: string;
  readonly kinesisFirehoseDeliveryType: string;
  readonly bucketDestination: Bucket;
  readonly kinesisFirehoseConfig: KinesisFirehoseConfig;
  readonly flowType: number;
  readonly kdsKms?: Key;
}

export class KinesisFirehoseConstruct extends Construct {
  public kinesisFirehoseArn: string;
  constructor(
    scope: Construct,
    id: string,
    props: KinesisFirehoseConstructProps
  ) {
    super(scope, id);

    let kinesisFireHose = this.createKinesisFirehose(props);
    this.kinesisFirehoseArn = kinesisFireHose.attrArn;
  }

  createKinesisFirehose(props: KinesisFirehoseConstructProps) {
    let deliveryType =
      props.kinesisFirehoseDeliveryType == "KinesisStreamAsSource" &&
      props.flowType == 1
        ? props.kinesisFirehoseDeliveryType
        : "DirectPut";
    let deliveryProps =
      props.flowType == 1 ? this.setDeliveryPropsKDSToS3(props) : {};
    return new CfnDeliveryStream(
      this,
      `KinesisFirehose-${process.env.PRJ_NAME}`,
      {
        deliveryStreamType: deliveryType,
        deliveryStreamName: `${props.kinesisFireHoseName}`,
        extendedS3DestinationConfiguration: {
          bucketArn: props.bucketDestination.bucketArn,
          bufferingHints: {
            sizeInMBs:
              typeof props.kinesisFirehoseConfig.bufferingHints?.sizeInMbs ==
              "number"
                ? props.kinesisFirehoseConfig.bufferingHints?.sizeInMbs
                : 5,
            intervalInSeconds:
              typeof props.kinesisFirehoseConfig.bufferingHints
                ?.intervalInSeconds == "number"
                ? props.kinesisFirehoseConfig.bufferingHints?.intervalInSeconds
                : 300,
          },
          prefix: props.kinesisFirehoseConfig.s3Prefix,
          errorOutputPrefix: props.kinesisFirehoseConfig.errorOutputPrefix,
          roleArn: this.createRoleService(props),
          dynamicPartitioningConfiguration: {
            enabled:
              props.kinesisFirehoseConfig.dynamicPartition !== undefined
                ? props.kinesisFirehoseConfig.dynamicPartition
                : false,
          },
          processingConfiguration:
            props.kinesisFirehoseConfig.dynamicPartition == true
              ? this.setProcessingConfiguration(props)
              : {},
          cloudWatchLoggingOptions: {
            enabled: true,
            logGroupName: `/aws/kinesisfirehose/${props.kinesisFireHoseName}`,
            logStreamName: "DeliveryStream",
          },
        },
        ...deliveryProps,
      }
    );
  }

  setProcessingConfiguration(props: KinesisFirehoseConstructProps) {
    if (
      (props.kinesisFirehoseConfig.dynamicPartition != undefined ||
        props.kinesisFirehoseConfig.dynamicPartition == true) &&
      props.kinesisFirehoseConfig.processingConfiguration == undefined
    ) {
      throw Error(
        "DynamicPartition enabled and processingConfiguration must not undefined"
      );
    } else {
      let processingConfiguration: CfnDeliveryStream.ProcessingConfigurationProperty =
        {
          enabled: true,
          processors: props.kinesisFirehoseConfig.processingConfiguration.map(
            (config) => ({
              type: this.setTypeProcessingConfiguration(config.parameterName),
              parameters: [
                ...(config.parameterName === "MetadataExtractionQuery"
                  ? [
                      {
                        parameterName: "JsonParsingEngine",
                        parameterValue: "JQ-1.6",
                      },
                    ]
                  : []),
                config,
              ],
            })
          ),
        };

      return processingConfiguration;
    }
  }

  setTypeProcessingConfiguration(parameterName: string): string{
    switch(parameterName){
      case "MetadataExtractionQuery":
        return "MetadataExtraction"
      case "Delimiter":
        return "AppendDelimiterToRecord"
      default:
        return "lambda"
    }
  }

  setDeliveryPropsKDSToS3(props: KinesisFirehoseConstructProps) {
    let configConsumer: CfnDeliveryStreamProps = {};

    configConsumer = {
      kinesisStreamSourceConfiguration: {
        kinesisStreamArn: props.kinesisDataStream!.streamArn,
        roleArn: this.createRoleKFToKDS(props.kinesisDataStream!.streamArn),
      },
    };
    return configConsumer;
  }

  createRoleKFToKDS(streamArn: string): string {
    let roleKinesis = new Role(this, `firehose-kds-role`, {
      assumedBy: new ServicePrincipal(`firehose.amazonaws.com`),
      inlinePolicies: {
        KinesisReadPolicyFromFirehose: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: [
                "kinesis:ListShards",
                "kinesis:GetRecords",
                "kinesis:DescribeStream",
                "kinesis:GetShardIterator",
              ],
              resources: [streamArn],
            }),
          ],
        }),
      },
    });
    return roleKinesis.roleArn;
  }

  createRoleService(props: KinesisFirehoseConstructProps) {
    const policy = new PolicyDocument({
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            "glue:GetTable",
            "glue:GetTableVersion",
            "glue:GetTableVersions",
          ],
          resources: [
            `arn:aws:glue:us-east-1:${process.env.ACCOUNT_ID}:catalog`,
            `arn:aws:glue:us-east-1:${process.env.ACCOUNT_ID}:database/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%`,
            `arn:aws:glue:us-east-1:${process.env.ACCOUNT_ID}:table/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%`,
          ],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["glue:GetSchemaVersion"],
          resources: ["*"],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            "s3:AbortMultipartUpload",
            "s3:GetBucketLocation",
            "s3:GetObject",
            "s3:ListBucket",
            "s3:ListBucketMultipartUploads",
            "s3:PutObject",
          ],
          resources: [
            `${props.bucketDestination.bucketArn}`,
            `${props.bucketDestination.bucketArn}/*`,
          ],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["lambda:InvokeFunction", "lambda:GetFunctionConfiguration"],
          resources: [
            `arn:aws:lambda:us-east-1:${process.env.ACCOUNT_ID}:function:%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%`,
          ],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["kms:GenerateDataKey", "kms:Decrypt"],
          resources: [
            `arn:aws:kms:us-east-1:${process.env.ACCOUNT_ID}:key/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%`,
          ],
          conditions: {
            StringEquals: {
              "kms:ViaService": "s3.us-east-1.amazonaws.com",
            },
            StringLike: {
              "kms:EncryptionContext:aws:s3:arn": [
                `arn:aws:s3:::%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%/*`,
                `arn:aws:s3:::%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%`,
              ],
            },
          },
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            "logs:PutLogEvents",
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
          ],
          resources: [
            `arn:aws:logs:us-east-1:${process.env.ACCOUNT_ID}:log-group:/aws/kinesisfirehose/${props.kinesisFireHoseName}*`,
            `arn:aws:logs:us-east-1:${process.env.ACCOUNT_ID}:log-group:%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%:log-stream:*`,
          ],
        }),
      ],
    });

    let role = new Role(this, `${process.env.PRJ_NAME}-KF-RoleService`, {
      assumedBy: new ServicePrincipal("firehose.amazonaws.com"),
      inlinePolicies: {
        kinesisFirehosePolicyService: policy,
      },
    });

    if (props.kinesisDataStream != undefined) {
      let policy = new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "kinesis:DescribeStream",
          "kinesis:GetShardIterator",
          "kinesis:GetRecords",
          "kinesis:ListShards",
        ],
        resources: [`${props.kinesisDataStream.streamArn}`],
      });

      let policyCondition = new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["kms:Decrypt"],
        resources: [
          `arn:aws:kms:us-east-1:${process.env.ACCOUNT_ID}:key/6bfcbc23-2cc1-4e2c-9403-dc2bc30be01a`,
        ],
        conditions: {
          StringEquals: {
            "kms:ViaService": "kinesis.us-east-1.amazonaws.com",
          },
          StringLike: {
            "kms:EncryptionContext:aws:kinesis:arn": `${props.kinesisDataStream.streamArn}`,
          },
        },
      });
      role.addToPolicy(policy);
      role.addToPolicy(policyCondition);
    }
    return role.roleArn;
  }

  createRoleKFToS3(
    s3Arn: string,
    streamArn: string,
    firehoseName: string
  ): string {
    let roleKinesis = new Role(this, `firehose-s3-role`, {
      assumedBy: new ServicePrincipal(`firehose.amazonaws.com`),
      inlinePolicies: {
        s3WriteReadFromFirehose: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: [
                "s3:AbortMultipartUpload",
                "s3:GetBucketLocation",
                "s3:GetObject",
                "s3:ListBucket",
                "s3:ListBucketMultipartUploads",
                "s3:PutObject",
              ],
              resources: [s3Arn, `${s3Arn}/*`],
            }),
          ],
        }),
        kinesisFirehoseServicePolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["kms:*"],
              resources: [`*`],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: [
                "kinesis:DescribeStream",
                "kinesis:GetShardIterator",
                "kinesis:GetRecords",
                "kinesis:ListShards",
              ],
              resources: [streamArn],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["logs:PutLogEvents"],
              resources: [
                `arn:aws:logs:us-east-1:095171039719:log-group:/aws/kinesisfirehose/${firehoseName}:log-stream:*`,
              ],
            }),
          ],
        }),
      },
    });
    return roleKinesis.roleArn;
  }
}
