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
    }
  }
});