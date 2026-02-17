import { useCallback, useState } from 'react';
import { chatApi } from '../../../api/chat-api';
import type { AdminSettings, AdminStats, AdminUserSummary, UserRole } from '../../../types/api';
import { getErrorMessage } from '../../../utils/error-message';

interface UseAdminFeatureOptions {
  authToken: string | null;
  isAdmin: boolean | undefined;
  currentUserId: string | undefined;
  onNotice: (message: string | null) => void;
}

export function useAdminFeature(options: UseAdminFeatureOptions) {
  const { authToken, isAdmin, currentUserId, onNotice } = options;

  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
  const [loadingAdminStats, setLoadingAdminStats] = useState(false);
  const [adminStatsError, setAdminStatsError] = useState<string | null>(null);
  const [adminSettings, setAdminSettings] = useState<AdminSettings | null>(null);
  const [loadingAdminSettings, setLoadingAdminSettings] = useState(false);
  const [adminSettingsError, setAdminSettingsError] = useState<string | null>(null);
  const [savingAdminSettings, setSavingAdminSettings] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUserSummary[]>([]);
  const [loadingAdminUsers, setLoadingAdminUsers] = useState(false);
  const [adminUsersError, setAdminUsersError] = useState<string | null>(null);
  const [updatingAdminUserId, setUpdatingAdminUserId] = useState<string | null>(null);
  const [deletingAdminUserId, setDeletingAdminUserId] = useState<string | null>(null);
  const [clearingAdminUsers, setClearingAdminUsers] = useState(false);

  const loadAdminStats = useCallback(async () => {
    if (!authToken || !isAdmin) {
      return;
    }
    setLoadingAdminStats(true);
    try {
      const response = await chatApi.adminStats(authToken);
      setAdminStats(response.stats);
      setAdminStatsError(null);
    } catch (err) {
      setAdminStatsError(getErrorMessage(err, 'Could not load admin stats'));
    } finally {
      setLoadingAdminStats(false);
    }
  }, [authToken, isAdmin]);

  const loadAdminSettings = useCallback(async () => {
    if (!authToken || !isAdmin) {
      return;
    }
    setLoadingAdminSettings(true);
    try {
      const response = await chatApi.adminSettings(authToken);
      setAdminSettings(response.settings);
      setAdminSettingsError(null);
    } catch (err) {
      setAdminSettingsError(getErrorMessage(err, 'Could not load admin settings'));
    } finally {
      setLoadingAdminSettings(false);
    }
  }, [authToken, isAdmin]);

  const saveAdminSettings = useCallback(
    async (next: AdminSettings) => {
      if (!authToken || !isAdmin) {
        return;
      }
      setSavingAdminSettings(true);
      try {
        const response = await chatApi.updateAdminSettings(authToken, next);
        setAdminSettings(response.settings);
        setAdminSettingsError(null);
      } catch (err) {
        setAdminSettingsError(getErrorMessage(err, 'Could not save admin settings'));
      } finally {
        setSavingAdminSettings(false);
      }
    },
    [authToken, isAdmin],
  );

  const loadAdminUsers = useCallback(async () => {
    if (!authToken || !isAdmin) {
      return;
    }
    setLoadingAdminUsers(true);
    try {
      const response = await chatApi.adminUsers(authToken);
      setAdminUsers(response.users);
      setAdminUsersError(null);
    } catch (err) {
      setAdminUsersError(getErrorMessage(err, 'Could not load users'));
    } finally {
      setLoadingAdminUsers(false);
    }
  }, [authToken, isAdmin]);

  const updateAdminUser = useCallback(
    async (
      userId: string,
      input: Partial<{
        role: UserRole;
        avatarUrl: string | null;
        isSuspended: boolean;
        suspensionHours: number;
      }>,
    ) => {
      if (!authToken || !isAdmin) {
        return;
      }
      setUpdatingAdminUserId(userId);
      try {
        const response = await chatApi.updateAdminUser(authToken, userId, input);
        setAdminUsers((prev) => prev.map((user) => (user.id === userId ? response.user : user)));
        setAdminUsersError(null);
      } catch (err) {
        setAdminUsersError(getErrorMessage(err, 'Could not update user'));
      } finally {
        setUpdatingAdminUserId(null);
      }
    },
    [authToken, isAdmin],
  );

  const deleteAdminUser = useCallback(
    async (userId: string) => {
      if (!authToken || !isAdmin) {
        return;
      }
      setDeletingAdminUserId(userId);
      try {
        await chatApi.deleteAdminUser(authToken, userId);
        setAdminUsers((prev) => prev.filter((user) => user.id !== userId));
        setAdminUsersError(null);
      } catch (err) {
        setAdminUsersError(getErrorMessage(err, 'Could not delete user'));
      } finally {
        setDeletingAdminUserId(null);
      }
    },
    [authToken, isAdmin],
  );

  const clearAdminUsersExceptCurrent = useCallback(async () => {
    if (!authToken || !isAdmin) {
      return;
    }
    setClearingAdminUsers(true);
    try {
      const response = await chatApi.clearAdminUsersExceptSelf(authToken);
      setAdminUsers((prev) => prev.filter((user) => user.id === currentUserId));
      setAdminUsersError(null);
      onNotice(
        response.deletedCount === 1
          ? 'Deleted 1 user. Your account was kept.'
          : `Deleted ${response.deletedCount} users. Your account was kept.`,
      );
    } catch (err) {
      setAdminUsersError(getErrorMessage(err, 'Could not clear users'));
    } finally {
      setClearingAdminUsers(false);
    }
  }, [authToken, currentUserId, isAdmin, onNotice]);

  return {
    adminStats,
    loadingAdminStats,
    adminStatsError,
    adminSettings,
    loadingAdminSettings,
    adminSettingsError,
    savingAdminSettings,
    adminUsers,
    loadingAdminUsers,
    adminUsersError,
    updatingAdminUserId,
    deletingAdminUserId,
    clearingAdminUsers,
    loadAdminStats,
    loadAdminSettings,
    saveAdminSettings,
    loadAdminUsers,
    updateAdminUser,
    deleteAdminUser,
    clearAdminUsersExceptCurrent,
  };
}
