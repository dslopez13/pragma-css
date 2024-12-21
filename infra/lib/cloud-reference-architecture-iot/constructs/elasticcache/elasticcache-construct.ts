import { Construct } from "constructs";
import { ElasticCacheConfig } from "../../utils/helpers";
import { IVpc, SecurityGroup } from "aws-cdk-lib/aws-ec2";
import { startCase } from "lodash";
import { CfnCacheCluster, CfnSubnetGroup } from "aws-cdk-lib/aws-elasticache";

export interface ElasticCacheProps {
  elasticConfig: ElasticCacheConfig;
  prjName: string;
  vpc: IVpc
}

export class ElasticCacheConstruct extends Construct {
  private prjName: string;
  private vpc: IVpc
  public redisSG: SecurityGroup;
  public elasticClusterEndpoint: string;
  constructor(scope: Construct, id: string, props: ElasticCacheProps) {
    super(scope, id);
    this.prjName = props.prjName;
    this.vpc = props.vpc

    this.redisSG = this.createSg();
    let elasticCluster = this.createElasticCluster(props.elasticConfig);
    this.elasticClusterEndpoint = elasticCluster.attrRedisEndpointAddress
  }

  createElasticCluster(elasticConfig: ElasticCacheConfig){
    return new CfnCacheCluster(this, `${elasticConfig.name}-RedisCacheCluster`, {
        cacheNodeType: elasticConfig.nodeType,
        engine: 'redis',
        numCacheNodes: elasticConfig.numNodes,
        vpcSecurityGroupIds: [this.redisSG.securityGroupId],
        clusterName: elasticConfig.name,
        cacheSubnetGroupName: this.createSubnetGroup(elasticConfig).cacheSubnetGroupName
      })
  }

  createSg() {
    return new SecurityGroup(
      this,
      startCase(this.prjName) + "RedisSecurityGroup",
      {
        vpc: this.vpc,
      }
    );
  }

  createSubnetGroup(elasticConfig: ElasticCacheConfig) {
    const subnetsIds = [];
    for (let subnet of this.vpc.isolatedSubnets) {
      subnetsIds.push(subnet.subnetId);
    }
    return new CfnSubnetGroup(
      this,
      startCase(this.prjName) + "RedisSubnetGroup",
      {
        cacheSubnetGroupName:
          startCase(elasticConfig.name).replace(/ /g, "") +
          "redis-subnet-group",
        description:
          startCase(elasticConfig.name).replace(/ /g, "") + "RedisSubnetGroup",
        subnetIds: subnetsIds,
      }
    );
  }
}
