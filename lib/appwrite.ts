import { Client, Account, TablesDB, Storage, Teams, Functions } from "appwrite";

export const client = new Client()
  .setEndpoint("https://appwrite.jp-homelab.work/v1")
  .setProject("6a9863c5001f32855e65");

export const account = new Account(client);
export const tablesDB = new TablesDB(client);
export const storage = new Storage(client);
export const teams = new Teams(client);
export const functions = new Functions(client);
