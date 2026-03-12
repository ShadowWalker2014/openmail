import { createFileRoute } from "@tanstack/react-router";
import { Mail, CheckCircle } from "lucide-react";

export const Route = createFileRoute("/unsubscribe")({
  component: UnsubscribePage,
});

function UnsubscribePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="flex justify-center">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
            <CheckCircle className="h-6 w-6 text-muted-foreground" />
          </div>
        </div>
        <h1 className="text-[18px] font-semibold">You&apos;ve been unsubscribed</h1>
        <p className="text-[13px] text-muted-foreground">
          You will no longer receive emails from this sender.
        </p>
        <div className="pt-2 flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground">
          <Mail className="h-3.5 w-3.5" />
          <span>Powered by OpenMail</span>
        </div>
      </div>
    </div>
  );
}
