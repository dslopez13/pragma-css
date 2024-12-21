import { IVpc } from "aws-cdk-lib/aws-ec2";
import { IQueue } from "aws-cdk-lib/aws-sqs";

export interface DataStreamConfig {
  name: string;
  encryptedKms?: boolean;
  retetionDays?: number;
}

export interface SecretManagerConfig {
  name: string;
  description: string;
}
export interface ElasticCacheConfig {
  name: string;
  nodeType: string;
  numNodes: number;
}

export interface IotCoreRulesConfigDestination {
  name: string;
  type: string;
  kinesisPartitionKey?: string;
}
export interface IotCoreRulesConfig {
  name: string;
  query: string;
  actions: IotCoreRulesConfigDestination[];
}
export interface IoTCoreConfig {
  rulesConfig: IotCoreRulesConfig[];
}

export interface BucketDestinationConfig {
  name: string;
}

export interface BufferingHintsConfig {
  sizeInMbs: number;
  intervalInSeconds: number;
}

export interface ProcessingConfigurationConfig {
  parameterName: string;
  parameterValue: string;
}

export interface KinesisFirehoseConfig {
  s3Prefix: string;
  errorOutputPrefix: string;
  bufferingHints?: BufferingHintsConfig;
  dynamicPartition?: boolean;
  processingConfiguration: ProcessingConfigurationConfig[];
}

export interface FirehoseConfig {
  bucketDestination: BucketDestinationConfig;
  kinesisFirehoseConfig: KinesisFirehoseConfig;
}

export interface onErrorConfigKinesisTrigger {
  destinationOnfailure: string;
}

export interface TriggerConfig {
  nameResource: string;
  queue?: IQueue;
  batchSize: number;
  batchWindows: number;
  onErrorConfig?: onErrorConfigKinesisTrigger;
}

export interface TriggerConfigSchedule {
  expressionCron: string;
}

export interface TriggerLambdaConfig {
  type: string;
  kinesisTriggerConfig?: TriggerConfig;
  sqsTriggerConfig?: TriggerConfig;
  scheduleTriggerConfig?: TriggerConfigSchedule;
}

export interface LambdaConfigEnv {
  key: string;
  value: string;
}

export interface LambdaConfig {
  name: string;
  codePath: string;
  lang: string;
  vpc?: IVpc;
  vpcAccess: boolean;
  env: LambdaConfigEnv[];
  timeout?: number;
  triggersConfig?: TriggerLambdaConfig[];
}

export interface DequeuingProcessConfig {
  type: string;
  lambdaConfig: LambdaConfig;
  destinationConfig?: FirehoseConfig;
}
export interface OnErrorDequeuing {
  type: string;
  lambdaConfig: LambdaConfig;
}

export interface SqsConfig {
  name: string;
  dlq: boolean;
}

export interface SuscriptionsSNSConfig {
  type: string;
  name: string;
  queue?: IQueue;
}
export interface SnsConfig {
  name: string;
  fifo?: boolean;
  suscriptions: SuscriptionsSNSConfig[];
}

export interface KinesisDataStreamQueuing {
  type: string;
  lambdaConfig: LambdaConfig;
  sqsConfig: SqsConfig[];
  snsConfig: SnsConfig[];
}

export interface FastDataFlows {
  name: string;
  flowType: number;
  bucketDestination: BucketDestinationConfig;
  firehoseConfig: FirehoseConfig;
  kinesisFirehoseConfig?: KinesisFirehoseConfig;
  kinesisDataStreamQueuing?: KinesisDataStreamQueuing;
  dequeuingProcessConfig?: DequeuingProcessConfig[];
  onErrorDequeuing?: OnErrorDequeuing;
}

export interface IotArchFastDataConfig {
  kinesisDataStream: DataStreamConfig;
  secretManagerConfig: SecretManagerConfig;
  elasticCacheConfig: ElasticCacheConfig;
  iotCoreConfig: IoTCoreConfig;
  name: string;
  fastdataFlows: FastDataFlows[];
}

export interface IotArchFastData {
  config: IotArchFastDataConfig;
}
