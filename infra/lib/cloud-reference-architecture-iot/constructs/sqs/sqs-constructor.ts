import { Duration } from "aws-cdk-lib";
import { IQueue, Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export interface SQSConstructProps {
    readonly nameSqs: string;
    readonly dql: boolean;
    readonly daysRetention?: number;
    readonly prjName: string;
}

export class SQSConstruct extends Construct {
    public sqsArn: string
    public sqsDqlArn: string 
    public IQueue: IQueue
    public dlqUrl: string
    constructor(scope: Construct, id: string, props: SQSConstructProps){
        super(scope, id);
        const nameSQS = `${props.prjName}-${props.nameSqs}`
        if(props.dql){
            const deadLetterQueue = new Queue(this, nameSQS + 'DLQ', {
                queueName: `${nameSQS}-dlq`,
                retentionPeriod: props.daysRetention != undefined ? Duration.days(props.daysRetention) : Duration.days(1),
                encryption: QueueEncryption.SQS_MANAGED
            });
            let mainQueue = new Queue(this, nameSQS + 'MainQueue', {
                queueName: `${nameSQS}-main-queue`,
                visibilityTimeout: Duration.seconds(60),
                deadLetterQueue: {
                  maxReceiveCount: 10,
                  queue: deadLetterQueue
                },
                encryption: QueueEncryption.SQS_MANAGED
            })
            this.sqsDqlArn = deadLetterQueue.queueArn
            this.sqsArn = mainQueue.queueArn
            this.IQueue = mainQueue;
            this.dlqUrl = deadLetterQueue.queueUrl;

        }else {
            let mainQueue = new Queue(this, nameSQS + 'MainQueue', {
                queueName: `${nameSQS}-main-queue`,
                visibilityTimeout: Duration.seconds(30),
            })
            this.sqsArn = mainQueue.queueArn
            this.IQueue = mainQueue;
        }       

    }

}