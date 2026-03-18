import mongoose from "mongoose";

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  var __mongoose_customer_cache: MongooseCache | undefined;
}

const cached = global.__mongoose_customer_cache ?? {
  conn: null,
  promise: null,
};

global.__mongoose_customer_cache = cached;

export async function connectMongo() {
  const mongodbUri = process.env.MONGODB_URI;
  if (!mongodbUri) {
    throw new Error("Missing MONGODB_URI in environment variables.");
  }

  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(mongodbUri, { dbName: "cluso" });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
