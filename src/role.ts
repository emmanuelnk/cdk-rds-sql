import { RemovalPolicy } from "aws-cdk-lib"
import * as kms from "aws-cdk-lib/aws-kms"
import { IDatabaseCluster, IDatabaseInstance } from "aws-cdk-lib/aws-rds"
import { ISecret, Secret } from "aws-cdk-lib/aws-secretsmanager"
import { Construct } from "constructs"
import { IDatabase } from "./database"
import { Provider } from "./provider"
import { Role as CustomResourceRole } from "./role.custom-resource"

export interface RoleProps {
  /**
   * Provider.
   */
  readonly provider: Provider

  /**
   * SQL.
   */
  readonly roleName: string

  /**
   * Optional database this user is expected to use.
   *
   * If the database exists, connect privileges are granted.
   *
   * Specify none of `database` or `databaseName` or only one of them.
   *
   * @default no connection to any database is granted
   */
  readonly database?: IDatabase

  /**
   * Optional database name this user is expected to use.
   *
   * If the database exists, connect privileges are granted.
   *
   * Specify none of `database` or `databaseName` or only one of them.
   *
   * @default no connection to any database is granted
   */
  readonly databaseName?: string

  /**
   * A new secret is created for this user.
   *
   * Optionally encrypt it with the given key.
   */
  readonly encryptionKey?: kms.IKey

  /**
   * A new secret is created for this user.
   *
   * Optionally add secret name to the secret.
   */
  readonly secretName?: string
}

export class Role extends Construct {
  /**
   * The role name.
   */
  public readonly roleName: string

  /**
   * The generated secret.
   */
  public readonly secret: ISecret

  constructor(scope: Construct, id: string, props: RoleProps) {
    if (
      (props.database && props.databaseName) ||
      (!props.database && !props.databaseName)
    )
      throw "Specify either database or databaseName"
    super(scope, id)

    const host = (props.provider.cluster as IDatabaseCluster).clusterEndpoint
      ? (props.provider.cluster as IDatabaseCluster).clusterEndpoint.hostname
      : (props.provider.cluster as IDatabaseInstance).instanceEndpoint.hostname

    const port = (props.provider.cluster as IDatabaseCluster).clusterEndpoint
      ? (props.provider.cluster as IDatabaseCluster).clusterEndpoint.port
      : (props.provider.cluster as IDatabaseInstance).instanceEndpoint.port

    const identifier = (props.provider.cluster as IDatabaseCluster).clusterIdentifier
      ? (props.provider.cluster as IDatabaseCluster).clusterIdentifier
      : (props.provider.cluster as IDatabaseInstance).instanceIdentifier

    this.secret = new Secret(this, "Secret", {
      secretName: props.secretName,
      encryptionKey: props.encryptionKey,
      description: `Generated secret for postgres role ${props.roleName}`,
      generateSecretString: {
        passwordLength: 30, // Oracle password cannot have more than 30 characters
        secretStringTemplate: JSON.stringify({
          dbClusterIdentifier: identifier,
          engine: "postgres",
          host: host,
          port: port,
          username: props.roleName,
          dbname: props.database ? props.database.databaseName : props.databaseName,
        }),
        generateStringKey: "password",
        excludeCharacters: " %+~`#$&*()|[]{}:;<>?!'/@\"\\",
      },
      removalPolicy: RemovalPolicy.DESTROY,
    })
    const role = new CustomResourceRole(this, "PostgresRole", {
      provider: props.provider,
      roleName: props.roleName,
      passwordArn: this.secret.secretArn,
      database: props.database,
      databaseName: props.databaseName,
    })
    role.node.addDependency(this.secret)
    this.roleName = props.roleName
    this.secret.grantRead(props.provider.handler)
    if (this.secret.encryptionKey) {
      // It seems we need to grant explicit permission
      this.secret.encryptionKey.grantDecrypt(props.provider.handler)
    }
  }
}
