import { NextFunction, Router, Response } from "express";
import { isAuthenticated, AuthRequest } from "../middlewares/isAuthenticated";
import { createOrEditProject, getAllProjects, getProject } from "../controllers/projectController";

const router: Router = Router();

const asyncHandler = (
  fn: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>
) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

router.post("/", isAuthenticated, asyncHandler(createOrEditProject));
router.get("/getAll", isAuthenticated, asyncHandler(getAllProjects));
router.get("/:id", isAuthenticated, asyncHandler(getProject));

export { router as projectRouter };
