import { Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import { LambdaConfig, TriggerLambdaConfig } from "../../utils/helpers";
import { Role } from "aws-cdk-lib/aws-iam";
import { GoFunction } from "@aws-cdk/aws-lambda-go-alpha";
import { join } from "path";
import { KinesisEventSource, SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { IStream } from "aws-cdk-lib/aws-kinesis";
import { Architecture, Runtime, StartingPosition } from "aws-cdk-lib/aws-lambda";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { IVpc, SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { Constants } from "../../utils/constants";

export interface LambdaConstructProps {
    readonly lambdaConfig: LambdaConfig;
    readonly role: Role;
    readonly prjName: string;
    readonly kinesisDataStream?: IStream;
    readonly sgLambda: SecurityGroup;
    readonly elasticEndpoint: string;
}

interface EnvironmentVariables {
    [key: string]: string;
  }

export class LambdaConstruct extends Construct {
    readonly golangFunction: GoFunction;
    readonly vpc: IVpc
    readonly elasticEndpoint: string;
    public lambdaSG: SecurityGroup
    public lambdaName: string
    constructor(scope: Construct, id: string, props: LambdaConstructProps){
        super(scope, id);
        const nameLambda = `fn-${props.prjName}-${props.lambdaConfig.name}`
        if(props.lambdaConfig.vpc !== undefined){
            this.vpc = props.lambdaConfig.vpc;
            this.lambdaSG = props.sgLambda;
        }
        this.elasticEndpoint = props.elasticEndpoint;
        if(props.lambdaConfig.lang == Constants.GOLANG_LAMBDA_TYPE){
            this.golangFunction = this.createLambdaGo(nameLambda, props);
            if(props.lambdaConfig.triggersConfig !== undefined){
                this.createTriggersLambda(props.lambdaConfig.triggersConfig, this.golangFunction, nameLambda, props.kinesisDataStream!)
            }
            this.lambdaName = this.golangFunction.functionName
        }
    }

    createTriggersLambda(triggers: TriggerLambdaConfig[], lambda: GoFunction, nameLambda: string,kinesisDataStream?: IStream) {
        for(let i = 0; i < triggers.length; i ++){
            if(triggers[i].type == Constants.TRIGGER_TYPE_KINESIS){
                let batchSize = Constants.TRIGGER_TYPE_KINESIS_BATCH_SIZE_DEFAULT//6MB Default
                let windowsTime = Constants.TRIGGER_TYPE_KINESIS_BATCH_WINDOWS_DEFAULT//60 Seconds Default
                if(triggers[i].kinesisTriggerConfig !== undefined){
                    batchSize = triggers[i].kinesisTriggerConfig!.batchSize
                    windowsTime =triggers[i].kinesisTriggerConfig!.batchWindows
                }
                let eventSource = new KinesisEventSource(kinesisDataStream!, {
                    batchSize: batchSize,
                    maxBatchingWindow: Duration.seconds(windowsTime),
                    startingPosition: StartingPosition.TRIM_HORIZON
                })
                lambda.addEventSource(eventSource);
            }
            if(triggers[i].type == Constants.TRIGGER_TYPE_SQS){
                let batchSize = Constants.TRIGGER_TYPE_SQS_BATCH_SIZE_DEFAULT//50 Default
                let windowsTime = Constants.TRIGGER_TYPE_SQS_BATCH_WINDOWS_DEFAULT//60 Seconds Default
                if(triggers[i].sqsTriggerConfig! !== undefined){
                    batchSize = triggers[i].sqsTriggerConfig!.batchSize !== undefined ? triggers[i].sqsTriggerConfig!.batchSize : batchSize
                    windowsTime = triggers[i].sqsTriggerConfig!.batchWindows !== undefined ? triggers[i].sqsTriggerConfig!.batchWindows :  windowsTime
                }
                console.log("nameLamda: %s, triggerType: %s",nameLambda,triggers[i].type)
                let eventSource = new SqsEventSource(triggers[i].sqsTriggerConfig?.queue!, {
                    batchSize: batchSize,
                    maxBatchingWindow: Duration.seconds(windowsTime),
                    enabled: true
                })
                lambda.addEventSource(eventSource);
            }

            if(triggers[i].type == Constants.TRIGGER_TYPE_CRON){
                if(triggers[i].scheduleTriggerConfig! !== undefined){
                    let eventRule = new Rule(this, `${nameLambda}-schedulerule`, {
                        schedule: Schedule.expression(triggers[i].scheduleTriggerConfig!.expressionCron)
                    })
                    eventRule.addTarget(new LambdaFunction(lambda))
                }
            }

        }
    }

    createLambdaGo(nameLambda: string, props: LambdaConstructProps):GoFunction{
        const environmentVariables: EnvironmentVariables = {};

        props.lambdaConfig.env.forEach(config => {
            const modifiedKey = config.key.replace(/-/g, '_');
            environmentVariables[modifiedKey] = config.value;
            if(modifiedKey == Constants.REDIS_HOST_ENV_KEY){
                environmentVariables[modifiedKey] = this.elasticEndpoint;                
            }
        });
        console.log(join(__dirname, props.lambdaConfig.codePath, 'main.go'))
        const golangFn = new GoFunction(this, `${nameLambda}-lambda`, {
            // runtime: Runtime.GO_1_X,
            functionName: nameLambda,
            timeout: props.lambdaConfig.timeout == undefined ? Duration.seconds(60) : Duration.minutes(props.lambdaConfig.timeout),
            entry: join(__dirname, props.lambdaConfig.codePath, 'main.go'),
            role: props.role,
            environment: environmentVariables,
            architecture: Architecture.ARM_64,
            vpc: this.vpc,
            vpcSubnets: this.vpc != undefined ? {subnetType: SubnetType.PRIVATE_ISOLATED} : undefined,
            securityGroups: this.vpc != undefined ? [this.lambdaSG] : undefined      
             
          });
        new LambdaFunction(golangFn, {});
        return golangFn;
    }

}