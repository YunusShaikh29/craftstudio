import { NextFunction, Router, Response } from "express";
import { isAuthenticated, AuthRequest } from "../middlewares/isAuthenticated";
import { createOrEditProject } from "../controllers/projectController";

const router: Router = Router();

const asyncHandler = (
  fn: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>
) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

router.post("/", isAuthenticated, asyncHandler(createOrEditProject));

export { router as projectRouter };
