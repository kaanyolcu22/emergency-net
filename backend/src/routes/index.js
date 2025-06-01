import express from "express";
import publicRouter from './publicRoutes.js';
import protectedRouter from './protectedRoutes.js';
import { responseInterceptor } from "../middleware/responseInterceptor.js";

const indexRouter = express.Router();

indexRouter.use(express.json({ limit: '10mb' }));
indexRouter.use(express.urlencoded({ extended: true, limit: '10mb' }));

indexRouter.use(responseInterceptor);
indexRouter.use('/', publicRouter);
indexRouter.use('/', protectedRouter);

export default indexRouter;