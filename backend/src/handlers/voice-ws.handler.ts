/**
 * voice-ws.handler.ts
 *
 * Extracted voice-channel WebSocket logic.
 * Manages voice participant state, SFU signaling dispatch, session tracking,
 * and the disconnect grace period — all decoupled from the core WS plugin.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { VoiceSfuService, VoiceSfuProducerInfo } from '../services/voice-sfu.service.js';
import type { ChannelService } from '../services/channel.service.js';
import { AppError } from '../utils/app-error.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface VoiceParticipantState {
    userId: string;
    username: string;
    avatarUrl?: string;
    muted: boolean;
    deafened: boolean;
}

export interface VoiceClientContext {
    userId: string;
    username: string;
    avatarUrl: string | null;
    activeVoiceChannelId: string | null;
}

export type VoiceSfuRequestAction =
    | 'get-rtp-capabilities'
    | 'create-transport'
    | 'connect-transport'
    | 'produce'
    | 'close-producer'
    | 'list-producers'
    | 'consume'
    | 'resume-consumer'
    | 'restart-ice'
    | 'get-transport-stats';

export interface VoiceSfuRequestPayload {
    requestId: string;
    channelId: string;
    action: VoiceSfuRequestAction;
    data?: unknown;
}

// ─── Constants ───────────────────────────────────────────────────────

const DISCONNECT_GRACE_PERIOD_MS = 15_000;

// ─── Handler ─────────────────────────────────────────────────────────

export interface VoiceWsHandlerDeps {
    voiceSfuService: VoiceSfuService;
    channelService: ChannelService;
    log: FastifyBaseLogger;
    /** Send a typed WS message to all online sockets of a user */
    notifyUsers: (userIds: string[], type: string, payload: unknown) => void;
}

export class VoiceWsHandler {
    // Participant state per channel
    private readonly participants = new Map<string, Map<string, VoiceParticipantState>>();
    // Which channel a user is currently in
    private readonly activeChannelByUser = new Map<string, string>();
    // Session count tracking for multi-tab
    private readonly sessionCountByUser = new Map<string, number>();
    // Disconnect grace timers
    private readonly graceTimers = new Map<string, NodeJS.Timeout>();

    private readonly deps: VoiceWsHandlerDeps;

    constructor(deps: VoiceWsHandlerDeps) {
        this.deps = deps;
    }

    // ─── Getters ─────────────────────────────────────────────────────

    getParticipants(channelId: string): VoiceParticipantState[] {
        const map = this.participants.get(channelId);
        if (!map) return [];
        return Array.from(map.values()).sort((a, b) => a.username.localeCompare(b.username));
    }

    getAllVoiceStates(): Array<{ channelId: string; participants: VoiceParticipantState[] }> {
        return Array.from(this.participants.entries()).map(([channelId, map]) => ({
            channelId,
            participants: Array.from(map.values()).sort((a, b) => a.username.localeCompare(b.username)),
        }));
    }

    getActiveChannelForUser(userId: string): string | undefined {
        return this.activeChannelByUser.get(userId);
    }

    // ─── Join ────────────────────────────────────────────────────────

    async join(
        ctx: VoiceClientContext,
        channelId: string,
        opts: { muted?: boolean; deafened?: boolean },
    ): Promise<void> {
        // Validate channel exists and is voice
        const channel = await this.deps.channelService.getChannelSummaryForUser(channelId, ctx.userId);
        if (!channel) {
            throw new AppError('CHANNEL_NOT_FOUND', 404, 'Channel not found');
        }
        if (!channel.isVoice) {
            throw new AppError('INVALID_VOICE_CHANNEL', 400, 'Channel is not a voice channel');
        }

        // If already in a different channel, leave it first
        const existingChannelId = this.activeChannelByUser.get(ctx.userId);
        if (existingChannelId && existingChannelId !== channelId) {
            this.forceLeave(ctx.userId, existingChannelId);
        }

        // If re-joining the same channel from another tab, just bump session count
        if (ctx.activeVoiceChannelId !== channelId) {
            const nextCount = (this.sessionCountByUser.get(ctx.userId) ?? 0) + 1;
            this.sessionCountByUser.set(ctx.userId, nextCount);
            ctx.activeVoiceChannelId = channelId;
        }

        const deafened = Boolean(opts.deafened);
        const muted = deafened ? true : Boolean(opts.muted);

        const channelParticipants = this.participants.get(channelId) ?? new Map();
        channelParticipants.set(ctx.userId, {
            userId: ctx.userId,
            username: ctx.username,
            avatarUrl: ctx.avatarUrl ?? undefined,
            muted,
            deafened,
        });
        this.participants.set(channelId, channelParticipants);
        this.activeChannelByUser.set(ctx.userId, channelId);

        this.log('info', 'voice_join', { userId: ctx.userId, channelId, muted, deafened, participants: channelParticipants.size });
        this.broadcastVoiceState(channelId);
    }

    // ─── Leave ───────────────────────────────────────────────────────

    leave(ctx: VoiceClientContext, channelId?: string): void {
        const targetChannelId = channelId ?? ctx.activeVoiceChannelId ?? this.activeChannelByUser.get(ctx.userId);
        if (!targetChannelId) return;

        this.decrementAndLeave(ctx.userId, targetChannelId, false);

        if (!channelId || channelId === ctx.activeVoiceChannelId) {
            ctx.activeVoiceChannelId = null;
        }

        this.log('info', 'voice_leave', { userId: ctx.userId, channelId: targetChannelId });
    }

    /** Force leave — ignores session count (used on disconnect grace expiry, channel switch) */
    forceLeave(userId: string, channelId: string): void {
        this.decrementAndLeave(userId, channelId, true);
    }

    private decrementAndLeave(userId: string, channelId: string, force: boolean): void {
        const channelParticipants = this.participants.get(channelId);
        if (!channelParticipants) {
            this.activeChannelByUser.delete(userId);
            this.sessionCountByUser.delete(userId);
            this.cleanupSfuPeer(userId, channelId);
            return;
        }

        if (force) {
            this.sessionCountByUser.delete(userId);
        } else {
            const next = Math.max(0, (this.sessionCountByUser.get(userId) ?? 0) - 1);
            if (next > 0) {
                this.sessionCountByUser.set(userId, next);
                return; // Other tabs still connected
            }
            this.sessionCountByUser.delete(userId);
        }

        channelParticipants.delete(userId);
        this.activeChannelByUser.delete(userId);

        const removedProducers = this.cleanupSfuPeer(userId, channelId);

        if (channelParticipants.size === 0) {
            this.participants.delete(channelId);
        }

        // Notify remaining participants about removed producers
        for (const producer of removedProducers) {
            this.notifyVoiceChannel(channelId, 'voice:sfu:event', {
                channelId,
                event: 'producer-removed',
                producerId: producer.producerId,
                userId: producer.userId,
            });
        }

        this.broadcastVoiceState(channelId);
    }

    // ─── Self State ──────────────────────────────────────────────────

    updateSelfState(
        ctx: VoiceClientContext,
        opts: { channelId?: string; muted?: boolean; deafened?: boolean },
    ): void {
        const activeChannelId = ctx.activeVoiceChannelId ?? this.activeChannelByUser.get(ctx.userId);
        if (!activeChannelId) {
            throw new AppError('VOICE_NOT_JOINED', 403, 'Join the voice channel first');
        }
        if (opts.channelId && opts.channelId !== activeChannelId) {
            throw new AppError('INVALID_CHANNEL', 400, 'Invalid channelId for voice state');
        }

        const channelParticipants = this.participants.get(activeChannelId);
        const current = channelParticipants?.get(ctx.userId);
        if (!channelParticipants || !current) {
            throw new AppError('VOICE_NOT_JOINED', 403, 'Join the voice channel first');
        }

        const deafened = Boolean(opts.deafened);
        const muted = deafened ? true : Boolean(opts.muted);
        channelParticipants.set(ctx.userId, { ...current, muted, deafened });

        this.log('info', 'voice_self_state', { userId: ctx.userId, channelId: activeChannelId, muted, deafened });
        this.broadcastVoiceState(activeChannelId);
    }

    // ─── SFU Request Dispatch ────────────────────────────────────────

    async handleSfuRequest(
        ctx: VoiceClientContext,
        payload: VoiceSfuRequestPayload,
    ): Promise<{ ok: boolean; data?: unknown; code?: string; message?: string }> {
        const sfu = this.deps.voiceSfuService;

        if (!sfu.enabled) {
            return { ok: false, code: 'SFU_DISABLED', message: 'Server-side voice transport is disabled' };
        }

        const activeChannelId = ctx.activeVoiceChannelId ?? this.activeChannelByUser.get(ctx.userId);
        if (activeChannelId !== payload.channelId) {
            return { ok: false, code: 'VOICE_NOT_JOINED', message: 'Join the voice channel first' };
        }

        try {
            switch (payload.action) {
                case 'get-rtp-capabilities': {
                    const rtpCapabilities = await sfu.getRouterRtpCapabilities(payload.channelId);
                    return { ok: true, data: { rtpCapabilities, audioOnly: sfu.audioOnly } };
                }

                case 'create-transport': {
                    const reqData = payload.data as { direction?: 'send' | 'recv' } | undefined;
                    if (reqData?.direction !== 'send' && reqData?.direction !== 'recv') {
                        return { ok: false, code: 'INVALID_SFU_REQUEST', message: 'Missing transport direction' };
                    }
                    const transport = await sfu.createTransport(payload.channelId, ctx.userId, reqData.direction);
                    return { ok: true, data: { transport } };
                }

                case 'connect-transport': {
                    const reqData = payload.data as { transportId?: string; dtlsParameters?: unknown } | undefined;
                    if (!reqData?.transportId || !reqData.dtlsParameters) {
                        return { ok: false, code: 'INVALID_SFU_REQUEST', message: 'Missing transportId or dtlsParameters' };
                    }
                    await sfu.connectTransport(
                        payload.channelId,
                        ctx.userId,
                        reqData.transportId,
                        reqData.dtlsParameters as Parameters<VoiceSfuService['connectTransport']>[3],
                    );
                    return { ok: true, data: { connected: true } };
                }

                case 'produce': {
                    const reqData = payload.data as {
                        transportId?: string;
                        kind?: 'audio' | 'video';
                        rtpParameters?: unknown;
                        appData?: Record<string, unknown>;
                    } | undefined;
                    if (!reqData?.transportId || !reqData.kind || !reqData.rtpParameters) {
                        return { ok: false, code: 'INVALID_SFU_REQUEST', message: 'Missing produce payload fields' };
                    }
                    const producer = await sfu.produce(
                        payload.channelId,
                        ctx.userId,
                        reqData.transportId,
                        reqData.kind,
                        reqData.rtpParameters as Parameters<VoiceSfuService['produce']>[4],
                        reqData.appData,
                    );
                    // Notify other participants
                    this.notifyVoiceChannel(
                        payload.channelId,
                        'voice:sfu:event',
                        { channelId: payload.channelId, event: 'producer-added', producer },
                        ctx.userId,
                    );
                    return { ok: true, data: { producer } };
                }

                case 'close-producer': {
                    const reqData = payload.data as { producerId?: string } | undefined;
                    if (!reqData?.producerId) {
                        return { ok: false, code: 'INVALID_SFU_REQUEST', message: 'Missing producerId' };
                    }
                    const closed = sfu.closeProducer(payload.channelId, ctx.userId, reqData.producerId);
                    if (closed) {
                        this.notifyVoiceChannel(payload.channelId, 'voice:sfu:event', {
                            channelId: payload.channelId,
                            event: 'producer-removed',
                            producerId: reqData.producerId,
                            userId: ctx.userId,
                        });
                    }
                    return { ok: true, data: { closed } };
                }

                case 'list-producers': {
                    const producers = sfu.getProducerInfos(payload.channelId, { excludeUserId: ctx.userId });
                    return { ok: true, data: { producers } };
                }

                case 'consume': {
                    const reqData = payload.data as {
                        transportId?: string;
                        producerId?: string;
                        rtpCapabilities?: unknown;
                    } | undefined;
                    if (!reqData?.transportId || !reqData.producerId || !reqData.rtpCapabilities) {
                        return { ok: false, code: 'INVALID_SFU_REQUEST', message: 'Missing consume payload fields' };
                    }
                    const consumer = await sfu.consume(
                        payload.channelId,
                        ctx.userId,
                        reqData.transportId,
                        reqData.producerId,
                        reqData.rtpCapabilities as Parameters<VoiceSfuService['consume']>[4],
                    );
                    return { ok: true, data: { consumer } };
                }

                case 'resume-consumer': {
                    const reqData = payload.data as { consumerId?: string } | undefined;
                    if (!reqData?.consumerId) {
                        return { ok: false, code: 'INVALID_SFU_REQUEST', message: 'Missing consumerId' };
                    }
                    const resumed = await sfu.resumeConsumer(payload.channelId, ctx.userId, reqData.consumerId);
                    return { ok: true, data: { resumed } };
                }

                case 'restart-ice': {
                    const reqData = payload.data as { transportId?: string } | undefined;
                    if (!reqData?.transportId) {
                        return { ok: false, code: 'INVALID_SFU_REQUEST', message: 'Missing transportId' };
                    }
                    const result = await sfu.restartIce(payload.channelId, ctx.userId, reqData.transportId);
                    return { ok: true, data: { iceParameters: result.iceParameters } };
                }

                case 'get-transport-stats': {
                    const stats = sfu.getTransportStats(payload.channelId, ctx.userId);
                    return { ok: true, data: { transports: stats } };
                }

                default:
                    return { ok: false, code: 'INVALID_SFU_REQUEST', message: `Unknown SFU action: ${payload.action}` };
            }
        } catch (error) {
            if (error instanceof AppError) {
                return { ok: false, code: error.code, message: error.message };
            }
            this.log('error', 'sfu_request_failed', { action: payload.action, error: String(error) });
            return { ok: false, code: 'SFU_REQUEST_FAILED', message: 'Could not process SFU request' };
        }
    }

    // ─── Disconnect Grace Period ─────────────────────────────────────

    /** Called when a socket disconnects. Starts a grace timer instead of immediately tearing down voice. */
    onSocketDisconnect(userId: string, activeVoiceChannelId: string | null): void {
        if (!activeVoiceChannelId) return;

        const channelId = activeVoiceChannelId;
        const timerId = setTimeout(() => {
            this.graceTimers.delete(userId);
            const currentChannel = this.activeChannelByUser.get(userId);
            if (currentChannel === channelId) {
                this.log('info', 'grace_period_expired', { userId, channelId });
                this.forceLeave(userId, channelId);
            }
        }, DISCONNECT_GRACE_PERIOD_MS);

        this.graceTimers.set(userId, timerId);
        this.log('info', 'grace_period_started', { userId, channelId, ms: DISCONNECT_GRACE_PERIOD_MS });
    }

    /** Called when a user re-authenticates. Clears any pending grace timer. */
    onSocketReconnect(userId: string): string | null {
        const pendingTimer = this.graceTimers.get(userId);
        if (pendingTimer) {
            clearTimeout(pendingTimer);
            this.graceTimers.delete(userId);
            this.log('info', 'grace_period_cancelled', { userId });
        }

        // Return the channel they were in so context can be restored
        return this.activeChannelByUser.get(userId) ?? null;
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    private cleanupSfuPeer(userId: string, channelId: string): VoiceSfuProducerInfo[] {
        if (!this.deps.voiceSfuService.enabled) return [];
        return this.deps.voiceSfuService.removePeer(channelId, userId);
    }

    private broadcastVoiceState(channelId: string): void {
        const participants = this.getParticipants(channelId);
        const payload = { channelId, participants };
        // Broadcast to ALL connected users (not just channel members)
        // since the sidebar shows voice participants
        const allUserIds = new Set<string>();
        for (const [, map] of this.participants) {
            for (const userId of map.keys()) {
                allUserIds.add(userId);
            }
        }
        // Also include users not in any voice channel but who are online
        // (handled by ws.plugin sending to all userSubscribers)
        this.deps.notifyUsers(Array.from(allUserIds), 'voice:state', payload);
    }

    private notifyVoiceChannel(
        channelId: string,
        type: string,
        payload: unknown,
        excludeUserId?: string,
    ): void {
        const channelParticipants = this.participants.get(channelId);
        if (!channelParticipants) return;

        const userIds = Array.from(channelParticipants.keys()).filter((id) => id !== excludeUserId);
        if (userIds.length === 0) return;

        this.deps.notifyUsers(userIds, type, payload);
    }

    private log(level: 'debug' | 'info' | 'warn' | 'error', event: string, details: Record<string, unknown>): void {
        this.deps.log[level]({ event, ...details }, 'voice-event');
    }
}
