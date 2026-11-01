import { NotificationType } from '@prisma/client';

export type TNotification = {
  id: number;
  type: NotificationType;
  title: string;
  detail: string;
  link: string | null;
  leagueId: number | null;
  unread: boolean;
  createdAt: Date;
};

// What a module raises when something happens. userId and the rest are filled
// by the caller; the service only writes the row.
export type TNotifyInput = {
  userId: number;
  type: NotificationType;
  title: string;
  detail: string;
  leagueId?: number | null;
  link?: string | null;
};
