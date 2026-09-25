import express from "express";
import { avatarUsername } from "../shared/user-avatar";
import type { UserAvatars } from "./user-avatars";

export function userAvatarRouter(avatars: UserAvatars) {
  const router = express.Router();
  router.get("/:username/avatar", async (req, res) => {
    const username = avatarUsername(req.params.username);
    if (!username)
      return void res.status(400).json({ message: "Invalid Reddit username." });
    try {
      const avatar = await avatars.get(username);
      res.setHeader("Cache-Control", "private, max-age=300");
      res.json({ username, avatar });
    } catch {
      res
        .status(503)
        .json({ message: "The avatar is temporarily unavailable." });
    }
  });
  return router;
}
