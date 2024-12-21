import { Construct } from "constructs";
import { SuscriptionsSNSConfig } from "../../utils/helpers";
import { Topic } from "aws-cdk-lib/aws-sns";
import { SqsSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { Constants } from "../../utils/constants";

export interface SNSConstructProps {
    readonly nameSNS: string;
    readonly suscriptions: SuscriptionsSNSConfig[];
    readonly prjName: string;
    readonly fifo: boolean;
}

export class SNSConstruct extends Construct {
    public SNSArn: string 
    constructor(scope: Construct, id: string, props: SNSConstructProps){
        super(scope, id);
        let topicName = `${props.prjName}-${props.nameSNS}`
        let topic = new Topic(this, `${topicName}`, {
            topicName: topicName,
            fifo: props.fifo
        })
        for(let i = 0; i < props.suscriptions.length; i++){
            if(props.suscriptions[i].type == Constants.SUBSCRIPTION_TYPE_SQS){
                topic.addSubscription(new SqsSubscription(props.suscriptions[i].queue!))
            }
        }

        this.SNSArn = topic.topicArn;

    }
}