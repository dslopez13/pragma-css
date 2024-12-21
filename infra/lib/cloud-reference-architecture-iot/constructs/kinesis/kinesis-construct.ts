import { Construct } from "constructs";
import { Duration, aws_kms, aws_kinesis as kinesis } from "aws-cdk-lib";
import { Effect, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { startCase } from "lodash";
import { Key } from "aws-cdk-lib/aws-kms";
import { CfnDeliveryStream, CfnDeliveryStreamProps } from "aws-cdk-lib/aws-kinesisfirehose";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Queue } from "aws-cdk-lib/aws-sqs";

export interface KinesisProductsProps {
  readonly kinesisDataStream: string;
  readonly kinesisDataStreamNames: string;
  readonly kinesisPrjName: string;
  readonly kinesisFireHoseNames: string;
}

export interface KinesisFirehoseProps {
  readonly kinesisDataStream: kinesis.Stream;
  readonly s3: Bucket;
  readonly sqs: Queue;
  readonly flowType: number;
}

/***
 * FastData
 * Flow 1
 * kinesisDataStream - kinesisFirehose - S3
 * 
 * Flow 2
 * kinesisDataStream - lambda - sns - sqs -
 * 
 * Flow 3
 * sqs - lambda 
 * 
 * Flow 4
 * sqs - lambda - KinesisFirehose - S3
 */
export class KinesisProducts extends Construct {
  public policyStatementKinesis: PolicyStatement
  public kinesisDataStreamArns: string[] = [];
  private resourcesArns: string[] = [];
  private actions: string[] = [];
  private prjName: string
  constructor(scope: Construct, id: string, props: KinesisProductsProps) {
    super(scope, id);
    this.prjName = startCase(props.kinesisPrjName).replace(/ /g, '')
    //Create KMS Kinesis
    const kinesisKMS = this.createKinesisKMS();

    //Create KinesisDataStream
    this.createKinesisDataSteam(props, kinesisKMS);

    //Create policy with all permission for kinesis products.
    this.policyStatementKinesis = this.createStatementPolicy(this.prjName);
  }

  createKinesisFirehose(props: KinesisProductsProps, propsKF: KinesisFirehoseProps){
    let kinesisFirehoseName = propsKF.flowType == 1 ? `KDS-${propsKF.kinesisDataStream.streamName}-S3-${propsKF.s3.bucketName}` : `SQS-${propsKF.sqs.queueName}-S3-${propsKF.s3.bucketName}`
    let deliveryStreamType =  propsKF.flowType == 1 ? 'KinesisStreamAsSourcer' : 'DirectPut'
    let deliveryProps =  propsKF.flowType == 1 ? this.setDeliveryPropsKDS(propsKF) : {}
    new CfnDeliveryStream(this, `KinesisFirehose-${process.env.ENV}`, {
      deliveryStreamType: deliveryStreamType,
      deliveryStreamName: `${kinesisFirehoseName}`,
      ...deliveryProps

    })
  }

  setDeliveryPropsKDS(propsKF: KinesisFirehoseProps){
    let configConsumer: CfnDeliveryStreamProps = {
      kinesisStreamSourceConfiguration: {
        kinesisStreamArn: propsKF.kinesisDataStream.streamArn,
        roleArn: this.createRoleKFToKDS(propsKF.kinesisDataStream.streamArn)
      },
      extendedS3DestinationConfiguration: {
        bucketArn: propsKF.s3.bucketArn,
        bufferingHints: {
          sizeInMBs: 5,
          intervalInSeconds: 300
        },
        prefix: 'domain=!{partitionKeyFromQuery:domain}/category=!{partitionKeyFromQuery:category}/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/hour=!{timestamp:HH}/',
        errorOutputPrefix: 'errors/domain=!{partitionKeyFromQuery:domain}/category=!{partitionKeyFromQuery:category}/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/hour=!{timestamp:HH}/',
        roleArn: this.createRoleKFToS3(propsKF.s3.bucketArn),
        dynamicPartitioningConfiguration: {
          enabled: true
        }
      }
    }
    return configConsumer;
  }

  createStatementPolicy(prjName: string){
    return new PolicyStatement({
      sid:
        prjName +
        "SAPolicyStatementKinesis",
      effect: Effect.ALLOW,
      actions: this.actions,
      resources: this.resourcesArns,
    });
  }

  createKinesisDataSteam(props: KinesisProductsProps, kinesisKMS:Key){
    if (props.kinesisDataStream == "true") {
      let kinesisDataStreamNamesArray =
        props.kinesisDataStreamNames!.split(",");
      for (let i = 0; i < kinesisDataStreamNamesArray.length; i++) {
        let kinesisDataStream = new kinesis.Stream(
          this,
          `KinesisDataStream${kinesisDataStreamNamesArray[i]}`,
          {
            streamName: `${this.prjName}-${kinesisDataStreamNamesArray[i]}-datastream`,
            retentionPeriod: Duration.days(1),
            streamMode: kinesis.StreamMode.ON_DEMAND,
            encryptionKey: kinesisKMS,
          }
        );
        this.resourcesArns.push(kinesisDataStream.streamArn);
        this.kinesisDataStreamArns.push(kinesisDataStream.streamArn);
      }
      this.actions.push(
        "kinesis:SubscribeToShard",
        "kinesis:ListShards",
        "kinesis:PutRecords",
        "kinesis:GetShardIterator",
        "kinesis:DescribeStream",
        "kinesis:DescribeStreamSummary",
        "kinesis:DescribeStreamConsumer",
        "kinesis:RegisterStreamConsumer",
        "kinesis:PutRecord"
      );
    }
  }

  createRoleKFToKDS(streamArn: string): string{
    let roleKinesis = new Role(this, `firehose-kds-role`, {
      assumedBy: new ServicePrincipal(`firehose.amazonaws.com`),
      inlinePolicies: {
          KinesisReadPolicyFromFirehose: new PolicyDocument({
              statements:[
                  new PolicyStatement(
                    {
                      effect: Effect.ALLOW,
                      actions: ["kinesis:ListShards","kinesis:GetRecords","kinesis:DescribeStream","kinesis:GetShardIterator"],
                      resources: [streamArn]
                    })

              ]
          })
      }
    })
    return roleKinesis.roleArn;
  }
  createRoleKFToS3(s3Arn: string): string{
    let roleKinesis = new Role(this, `firehose-s3-role`, {
      assumedBy: new ServicePrincipal(`firehose.amazonaws.com`),
      inlinePolicies: {
          s3WriteRedFromFirehose: new PolicyDocument({
              statements:[
                  new PolicyStatement(
                    {
                      effect: Effect.ALLOW,
                      actions: ["s3:AbortMultipartUpload","s3:GetBucketLocation","s3:ListBucket","s3:ListBucketMultipartUploads","s3:PutObject"],
                      resources: [s3Arn,`${s3Arn}/*`]
                    })

              ]
          })
      }
    })
    return roleKinesis.roleArn;
  }

  createKinesisKMS(){
    const kinesisKMS = new aws_kms.Key(
      this,
      `KinesisKms${this.prjName}`
    );
    this.actions.push("kms:Decrypt");
    this.resourcesArns.push(kinesisKMS.keyArn);
    return kinesisKMS;
  }
}
