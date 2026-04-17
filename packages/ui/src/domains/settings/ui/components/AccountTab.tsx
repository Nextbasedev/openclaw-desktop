"use client"

import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

export function AccountTab() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your account information and profile details.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <Avatar className="size-14">
          <AvatarFallback className="bg-primary/10 text-primary text-lg font-medium">
            OC
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">Profile Picture</p>
          <p className="text-xs text-muted-foreground">
            Connected via OpenClaw Gateway
          </p>
        </div>
      </div>

      <Separator className="bg-border/50" />

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
          <label
            htmlFor="settings-name"
            className="text-sm text-muted-foreground"
          >
            Name
          </label>
          <Input
            id="settings-name"
            defaultValue="OpenClaw User"
            className="bg-muted/50 border-border/50"
          />
        </div>

        <div className="grid grid-cols-[120px_1fr] items-center gap-4">
          <label
            htmlFor="settings-email"
            className="text-sm text-muted-foreground"
          >
            Email
          </label>
          <div className="flex flex-col gap-1">
            <Input
              id="settings-email"
              defaultValue="user@openclaw.ai"
              className="bg-muted/50 border-border/50"
              readOnly
            />
            <p className="text-xs text-muted-foreground">
              Managed by your OpenClaw Gateway connection.
            </p>
          </div>
        </div>
      </div>

      <Separator className="bg-border/50" />

      <div>
        <h3 className="text-base font-semibold text-foreground">
          Connection Info
        </h3>
        <div className="mt-3 rounded-lg border border-border/50 bg-muted/30 p-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Gateway</span>
              <span className="text-sm font-mono text-foreground">
                ws://127.0.0.1:18789
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-emerald-500" />
                <span className="text-sm text-emerald-500">Connected</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Agent</span>
              <span className="text-sm font-mono text-foreground">main</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
