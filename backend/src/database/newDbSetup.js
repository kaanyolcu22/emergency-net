import { DataSource } from "typeorm";
import { User } from "./entity/User.js";
import { Message } from "./entity/Message.js";
import { Channel } from "./entity/Channel.js";
import { BlacklistedPU } from "./entity/BlacklistedPU.js";
import { fillBlacklist } from "../util/DatabaseUtil.js";
import { RecoveryRequest } from "./entity/RecoveryRequest.js";
import { RecoveryResponse } from "./entity/RecoveryResponse.js";

// In newDbSetup.js
const AppDataSource = new DataSource({
  type: "sqlite",
  database: "./Emergency-Net-DB.db",
  entities: [User, Message, Channel, BlacklistedPU, RecoveryRequest, RecoveryResponse], // Add the missing entities
  synchronize: true,
});

AppDataSource.initialize()
  .then(async () => {
    await fillBlacklist().then(() => console.log("Blacklist filled."));

    console.log("Data Source has been initialized!");
  })
  .catch((err) => {
    console.error("Error during Data Source initialization", err);
  });

export { AppDataSource };
