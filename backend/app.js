import express from "express";
import cookieParser from "cookie-parser";
import logger from "morgan";
import cors from "cors";
import "reflect-metadata";
import path from "path";
import indexRouter from "./src/routes/index.js";
import { fileURLToPath } from "url";

const app = express();

app.use(logger("dev"));

app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    const contentLength = req.headers['content-length'];
    if (contentLength && parseInt(contentLength) > 1000000) { 
      console.log(`Large request detected: ${req.url}, size: ${contentLength} bytes`);
    }
  },
  reviver: (key, value) => {
    return value;
  }
}));

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(cors());

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    console.error(`Payload too large error: ${req.url}`);
    return res.status(413).json({ 
      error: "Request entity too large", 
      message: "The data you're trying to send is too large. Please reduce the size and try again."
    });
  }
  next(err);
});

const baseUrl = process.env.BASE_URL || "/api";
app.use(baseUrl, indexRouter);

const dist = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "dist"
);
app.get(/^\/assets\/.*/, express.static(dist));
app.get(/[\s\S]*/, (req, res, next) => {
  res.sendFile(dist + "/index.html");
});

export default app;