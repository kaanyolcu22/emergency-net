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
    recoveryVersion: {
      type: "int",
      default: 1,
      nullable: true
    },
    recoverySourceAP: {
      type: "varchar",
      nullable: true
    },
    recoveryAttempts: {
      type: "int",
      default: 0,
      nullable: true
    },
    lastRecoveryAttempt: {
      type: "datetime",
      nullable: true
    },
    lastRecoveredAt: {
      type: "datetime",
      nullable: true
    },
    isRecoveryLocked: {
      type: "boolean",
      default: false
    },
    recoveryLockExpiresAt: {
      type: "datetime",
      nullable: true
    }
  }
});