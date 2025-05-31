import { EntitySchema } from "typeorm";

export const User = new EntitySchema({
  name: "User",
  tableName: "users",
  columns: {
    id: {
      primary: true,
      type: "int",
      generated: true
    },
    username: {
      type: "varchar",
      unique: true
    },
    recoveryKeyHash: {
      type: "varchar",
      nullable: true
    },
    recoveryKeySalt: {
      type: "varchar",
      nullable: true
    },
    recoveryKeyUpdatedAt: {
      type: "datetime",
      nullable: true
    },
    recoverySignature: {
      type: "varchar",
      nullable: true
    },
    recoverySource: {
      type: "varchar",
      nullable: true
    },
    recoveryAttempts: {
      type: "int",
      default: 0
    },
    recoveryLockedAt: {
      type: "datetime",
      nullable: true
    },
    lastRecoveryAttempt: {
      type: "datetime", 
      nullable: true
    },
    recoveryLockReason: {
      type: "varchar",
      nullable: true
    },
    ipAddressHash: {
      type: "varchar",
      nullable: true
    },
    deviceFingerprint: {
      type: "varchar",
      nullable: true
    },
    successfulRecoveries: {
      type: "int",
      default: 0
    },
    lastSuccessfulRecovery: {
      type: "datetime",
      nullable: true
    },
    securityFlags: {
      type: "varchar",
      nullable: true
    }
  },
  indices: [
    {
      name: "IDX_RECOVERY_LOCKED",
      columns: ["recoveryLockedAt"]
    },
    {
      name: "IDX_RECOVERY_ATTEMPTS",
      columns: ["recoveryAttempts", "lastRecoveryAttempt"]
    },
    {
      name: "IDX_USERNAME_RECOVERY",
      columns: ["username", "recoveryKeyHash"]
    }
  ]
});