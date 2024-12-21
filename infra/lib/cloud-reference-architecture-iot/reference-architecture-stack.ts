import { RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { startCase } from "lodash";
import path = require("path");
import * as fs from "fs";
import { ElasticCacheConfig, IotArchFastData, SecretManagerConfig } from "./utils/helpers";
import { KinesisDataStreamConstruct } from "./constructs/kinesis/kinesis-datastream-construct";
import { IVpc, Port, SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { ElasticCacheConstruct } from "./constructs/elasticcache/elasticcache-construct";
import { IoTCoreConstruct } from "./constructs/iot/iot-core-construct";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import { FlowKDS2Lambda2SNS } from "./constructs/flows/kds-to-lambda-to-sns";

export class ReferenceArchitectureIoTStack extends Stack {
  private prjName: string;
  private vpc: IVpc;
  private secret: Secret

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.prjName = startCase(process.env.PRJ_NAME).replace(/ /g, "");
    this.vpc = this.getVPC()
    
    const archConfig: IotArchFastData = this.setFlowsConfig();
    
    this.secret = this.createSecret(archConfig.config.secretManagerConfig)
    let elasticacheConstruct = this.createClusterElastic(archConfig.config.elasticCacheConfig);
    let sgLambdas = this.createSGLambdas();
    elasticacheConstruct.redisSG.connections.allowFrom(sgLambdas, Port.tcp(6379))

    //Create KDS
    let kinesisDataStreamConstruct = new KinesisDataStreamConstruct(
      this,
      `${this.prjName}KDSContruct-${archConfig.config.kinesisDataStream.name}`,
      {
        kinesisDataStreamName: archConfig.config.kinesisDataStream.name,
        kmsEncryptionKey:
          archConfig.config.kinesisDataStream.encryptedKms ?? false,
        retentionDays: archConfig.config.kinesisDataStream.retetionDays ?? 1,
        prjName: this.prjName,
      }
    );

    let iotRules = new IoTCoreConstruct(this, `${this.prjName}-IoTContruct`, {
        iotCoreConfig: archConfig.config.iotCoreConfig,
        prjName: this.prjName
    })
    

    archConfig.config.fastdataFlows.forEach((flow)=>{
        let firehoseBucketDestination: Bucket;
        firehoseBucketDestination = this.createBucketS3(flow.name, flow.bucketDestination.name)
        
        new FlowKDS2Lambda2SNS(this, `${this.prjName}-kds2lambda2sns2sqs`, {
            kinesisDataStreamSource: kinesisDataStreamConstruct.kinesisDataStream,
            prjName: this.prjName,
            config: flow,
            bucketDestination: firehoseBucketDestination,
            sgLambda: sgLambdas,
            elasticEndpoint: elasticacheConstruct.elasticClusterEndpoint,
            vpc: this.vpc,
            secret: this.secret
        })
    })



  }

  getVPC() {
    return Vpc.fromLookup(this, startCase(this.prjName) + "VPCLookup", {
      vpcId: process.env.VPC_ID,
    });
  }

  setFlowsConfig() {
    const jsonPath = process.env.CONFIG_PATH || "./flows/flows.json";
    const absolutePath = path.resolve(__dirname, jsonPath);
    const jsonData = fs.readFileSync(absolutePath, "utf-8");
    return JSON.parse(jsonData);
  }

  createSecret(secretConfig: SecretManagerConfig){
    const secret = new Secret(this, startCase(this.prjName).replace(/ /g, '') + 'Secret', {
      secretName: secretConfig.name,
      removalPolicy: RemovalPolicy.RETAIN,
      description: secretConfig.description
    });
    secret.applyRemovalPolicy(RemovalPolicy.RETAIN);
    return secret
  }

  createBucketS3(flow: string, bucketName: string): Bucket {
    let bucket =  new Bucket(this, `${flow}-bucket-${bucketName}`, {
      bucketName: bucketName,
      publicReadAccess: false,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN
    });

    return bucket
  }

  createClusterElastic(elasticCacheConfig: ElasticCacheConfig){
    return new ElasticCacheConstruct(this, startCase(this.prjName).replace(/ /g, '') + 'ElasticCacheCluster',{
      elasticConfig: elasticCacheConfig,
      prjName: this.prjName,
      vpc: this.vpc
    })
  }

  createSGLambdas(){
    return new SecurityGroup(this, startCase(this.prjName) + 'SGLambda', {
      vpc: this.vpc,
      allowAllOutbound: true,
      description: 'security group for lambdas fastdata',
    });
  }


}
