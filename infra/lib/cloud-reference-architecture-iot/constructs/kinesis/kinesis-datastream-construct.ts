import { Key } from "aws-cdk-lib/aws-kms";
import { Construct } from "constructs";
import { Duration, aws_kms, aws_kinesis as kinesis } from "aws-cdk-lib";
import { StreamEncryption } from "aws-cdk-lib/aws-kinesis";

export interface KinesisDSProps {
    readonly kinesisDataStreamName: string;
    readonly kmsEncryptionKey: boolean;
    readonly prjName: string;
    readonly retentionDays?: number;
}   

export class KinesisDataStreamConstruct extends Construct {
    public kmsKey: Key
    public kinesisDataStream: kinesis.Stream
    constructor(scope: Construct, id: string, props: KinesisDSProps){
        super(scope, id);

        if(props.kmsEncryptionKey){
            this.kmsKey = this.createKMS(props);
        }
        
        this.kinesisDataStream = this.createKinesisDataSteam(props, this.kmsKey);

    }

    createKinesisDataSteam(props: KinesisDSProps, kinesisKMS?:Key){
        let addEncription: kinesis.StreamProps = 
            kinesisKMS ? {
                encryptionKey: kinesisKMS
            } :
            {
                encryption: StreamEncryption.UNENCRYPTED
            }

        let kinesisDataStream = new kinesis.Stream(
            this,
            `${props.prjName}KDS${props.kinesisDataStreamName}`,
            {
            streamName: `${props.prjName}-${props.kinesisDataStreamName}-datastream`,
            retentionPeriod: props.retentionDays ? Duration.days(props.retentionDays) : Duration.days(1),
            streamMode: kinesis.StreamMode.ON_DEMAND,
            ...addEncription,
            }
        );

        return kinesisDataStream;
    }

    createKMS(props: KinesisDSProps){
        const kinesisKMS = new aws_kms.Key(
          this,
          `${props.prjName}-kms-${props.kinesisDataStreamName}`
        );
        return kinesisKMS;
      }
}