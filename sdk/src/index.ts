/**
 * @openmail/sdk — Node.js / Server-side entry point
 *
 * For browser usage, import from "@openmail/sdk/browser"
 * For React, import from "@openmail/sdk/react"
 * For Next.js, import from "@openmail/sdk/nextjs"
 */
export { OpenMail, createOpenMail } from "./node/index.js";
export { OpenMailError } from "./core/errors.js";
export type {
  OpenMailConfig,
  Group,
  CreateGroupInput,
  GroupMembership,
  Contact,
  CreateContactInput,
  UpdateContactInput,
  ListContactsOptions,
  PaginatedResponse,
  TrackOptions,
  TrackResult,
  EventRecord,
  Broadcast,
  CreateBroadcastInput,
  UpdateBroadcastInput,
  EmailSend,
  ListSendsOptions,
  TopLink,
  Campaign,
  CreateCampaignInput,
  UpdateCampaignInput,
  CampaignStep,
  CreateStepInput,
  UpdateStepInput,
  Segment,
  CreateSegmentInput,
  UpdateSegmentInput,
  SegmentUsage,
  EmailTemplate,
  CreateTemplateInput,
  UpdateTemplateInput,
  WorkspaceAnalytics,
  BroadcastAnalytics,
  Asset,
  UploadFromUrlInput,
  UploadBase64Input,
  PresignedUploadResult,
  GetUploadUrlInput,
  Traits,
  Properties,
  SegmentCompatible,
  PostHogCompatible,
  SegmentCondition,
  ConditionOperator,
  TriggerType,
  StepType,
  CampaignStatus,
  BroadcastStatus,
} from "./core/types.js";
