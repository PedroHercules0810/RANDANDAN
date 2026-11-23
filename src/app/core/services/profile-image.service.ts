import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { Score } from '../models/score.model';
import { Team } from '../models/team.model';
import { AuthService } from './auth.service';
import { ScoreService } from './score.service';
import { TeamService } from './team.service';

export interface StoredChatMessage {
  id: string;
  role: 'user' | 'model' | 'system';
  sender?: string;
  text: string;
  timestamp: string;
}

export interface DynamoRankingPilot {
  username: string;
  userId?: string;
  email?: string;
  teamId?: number | null;
  teamName?: string;
  totalPoints: number;
  s3Url?: string | null;
}

export interface ProfileImageMetadata {
  username?: string;
  tableName?: string;
  partitionKey?: string;
  s3Url?: string | null;
  bucket?: string;
  key?: string;
  contentType?: string;
  sizeBytes?: number;
  updatedAt?: string | null;
}

const DEFAULT_PROFILE_API_URL = 'https://gaff3pwpe0.execute-api.us-east-1.amazonaws.com/profile';
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

@Injectable({ providedIn: 'root' })
export class ProfileImageService {
  private readonly authService = inject(AuthService);
  private readonly scoreService = inject(ScoreService);
  private readonly teamService = inject(TeamService);

  private readonly endpointSignal = signal<string>(
    (environment as { profileApiUrl?: string }).profileApiUrl || DEFAULT_PROFILE_API_URL,
  );
  private readonly imageUrlSignal = signal<string | null>(null);
  private readonly s3UrlSignal = signal<string | null>(null);
  private readonly chatMessagesSignal = signal<StoredChatMessage[]>([]);
  private readonly globalRankingsSignal = signal<DynamoRankingPilot[]>([]);
  private readonly metadataSignal = signal<ProfileImageMetadata | null>(null);
  private readonly isLoadingSignal = signal<boolean>(false);
  private readonly isUploadingSignal = signal<boolean>(false);
  private readonly errorSignal = signal<string | null>(null);
  private readonly successSignal = signal<string | null>(null);

  readonly apiEndpoint = computed(() => this.endpointSignal());
  readonly imageUrl = computed(() => this.imageUrlSignal());
  readonly s3Url = computed(() => this.s3UrlSignal());
  readonly chatMessages = computed(() => this.chatMessagesSignal());
  readonly globalRankings = computed(() => this.globalRankingsSignal());
  readonly metadata = computed(() => this.metadataSignal());
  readonly isLoading = computed(() => this.isLoadingSignal());
  readonly isUploading = computed(() => this.isUploadingSignal());
  readonly errorMessage = computed(() => this.errorSignal());
  readonly successMessage = computed(() => this.successSignal());

  private lastLoadedUsername: string | null = null;

  constructor() {
    this.scoreService.registerDynamoSyncCallback?.((score) => {
      void this.syncScoreToDynamoDB(score);
    });

    this.teamService.registerDynamoSyncCallback?.((team) => {
      void this.syncTeamToDynamoDB(team);
    });

    // Carrega automaticamente a imagem do S3, histórico de mensagens, scores, equipe e ranking global do DynamoDB
    // assim que o usuário faz login (em qualquer navegador ou computador).
    effect(() => {
      const auth = this.authService.authState();
      if (auth.status === 'authenticated' && auth.user) {
        if (this.lastLoadedUsername !== auth.user.displayName) {
          this.lastLoadedUsername = auth.user.displayName;
          void this.loadProfileImage();
        }
      } else {
        this.lastLoadedUsername = null;
        this.imageUrlSignal.set(null);
        this.s3UrlSignal.set(null);
        this.chatMessagesSignal.set([]);
        this.metadataSignal.set(null);
      }
    });
  }

  /** Atualiza a URL da rota /profile caso o usuário queira testar outro endpoint do API Gateway. */
  setApiEndpoint(url: string): void {
    const trimmed = url.trim();
    if (trimmed) {
      this.endpointSignal.set(trimmed);
    }
  }

  /** Valida se o arquivo selecionado é exclusivamente uma imagem suportada. */
  validateImageFile(file: File): string | null {
    if (!file) {
      return 'Selecione um arquivo de imagem.';
    }

    const mime = (file.type || '').toLowerCase();
    const hasValidExtension = /\.(png|jpe?g|webp|gif)$/i.test(file.name);

    if (!ALLOWED_MIME_TYPES.has(mime) || !hasValidExtension) {
      return 'Formato inválido! Selecione exclusivamente um arquivo de imagem (.PNG, .JPG, .JPEG, .WEBP ou .GIF).';
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      return 'A imagem selecionada excede o limite máximo de 5 MB.';
    }

    return null;
  }

  /**
   * Busca no DynamoDB (pelo nome do usuário como chave principal):
   * - O link do S3 com a imagem do usuário e carrega a imagem do S3
   * - A lista de mensagens do usuário com o agente de IA
   * - O histórico de pontuações, equipe escolhida e o Ranking Global de todos os usuários do DynamoDB
   */
  async loadProfileImage(): Promise<void> {
    this.errorSignal.set(null);
    this.isLoadingSignal.set(true);

    try {
      await this.authService.ensureInitialized();
      const user = this.authService.authState().user;
      const token = await this.authService.getJwtToken();

      if (!token || !user) {
        this.errorSignal.set(
          'Sessão Cognito não encontrada. Faça login para carregar seu perfil do DynamoDB/S3.',
        );
        return;
      }

      const baseEndpoint = this.endpointSignal();
      const separator = baseEndpoint.includes('?') ? '&' : '?';
      const urlWithUsername = `${baseEndpoint}${separator}username=${encodeURIComponent(user.displayName)}`;

      const response = await fetch(urlWithUsername, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (response.status === 404) {
        this.imageUrlSignal.set(null);
        this.s3UrlSignal.set(null);
        return;
      }

      if (!response.ok) {
        let errMsg = `Erro HTTP ${response.status} ao buscar perfil no DynamoDB/S3 (GET /profile).`;
        try {
          const errJson = await response.json();
          if (errJson?.error || errJson?.message) {
            errMsg = errJson.error || errJson.message;
          }
        } catch {
          // Ignora se não for JSON
        }
        throw new Error(errMsg);
      }

      const contentTypeHeader = (response.headers.get('content-type') || '').toLowerCase();

      if (contentTypeHeader.startsWith('image/')) {
        const blob = await response.blob();
        const dataUrl = await this.blobToDataUrl(blob);
        this.imageUrlSignal.set(dataUrl);
        this.metadataSignal.set({
          username: user.displayName,
          contentType: contentTypeHeader,
          sizeBytes: blob.size,
        });
        return;
      }

      const data = (await response.json()) as {
        exists?: boolean;
        username?: string;
        tableName?: string;
        partitionKey?: string;
        s3Url?: string | null;
        imageUrl?: string | null;
        bucket?: string;
        key?: string;
        contentType?: string;
        sizeBytes?: number;
        updatedAt?: string | null;
        messages?: StoredChatMessage[];
        scores?: Score[];
        teamId?: number | null;
        rankings?: DynamoRankingPilot[];
      };

      if (Array.isArray(data?.messages)) {
        this.chatMessagesSignal.set(data.messages);
      }

      if (Array.isArray(data?.scores) && data.scores.length > 0) {
        this.scoreService.hydrateFromDynamoDB(data.scores);
      }

      if (data?.teamId) {
        this.teamService.hydrateFromDynamoDB(data.teamId);
      }

      if (Array.isArray(data?.rankings)) {
        this.globalRankingsSignal.set(data.rankings);
      }

      this.s3UrlSignal.set(data?.s3Url ?? null);
      this.imageUrlSignal.set(data?.imageUrl || data?.s3Url || null);
      this.metadataSignal.set({
        username: data?.username || user.displayName,
        tableName: data?.tableName,
        partitionKey: data?.partitionKey,
        s3Url: data?.s3Url ?? null,
        bucket: data?.bucket,
        key: data?.key,
        contentType: data?.contentType,
        sizeBytes: data?.sizeBytes,
        updatedAt: data?.updatedAt,
      });
    } catch (error) {
      this.errorSignal.set(
        (error as Error)?.message || 'Não foi possível carregar o perfil via GET /profile.',
      );
    } finally {
      this.isLoadingSignal.set(false);
    }
  }

  /**
   * Envia exclusivamente um arquivo de imagem para POST /profile:
   * - Salva a imagem no S3 (bucket profile)
   * - Registra no DynamoDB (chave principal = nome do usuário) o link do S3 da imagem
   */
  async uploadProfileImage(file: File): Promise<boolean> {
    this.errorSignal.set(null);
    this.successSignal.set(null);

    const validationError = this.validateImageFile(file);
    if (validationError) {
      this.errorSignal.set(validationError);
      return false;
    }

    this.isUploadingSignal.set(true);

    try {
      await this.authService.ensureInitialized();
      const user = this.authService.authState().user;
      const token = await this.authService.getJwtToken();
      if (!token || !user) {
        throw new Error('Token JWT do Amazon Cognito indisponível. Faça login novamente.');
      }

      const base64DataUrl = await this.blobToDataUrl(file);
      const endpoint = this.endpointSignal();

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          username: user.displayName,
          imageBase64: base64DataUrl,
          contentType: file.type,
          fileName: file.name,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data?.error || data?.message || `Falha no envio da imagem (HTTP ${response.status}).`,
        );
      }

      if (Array.isArray(data?.messages)) {
        this.chatMessagesSignal.set(data.messages);
      }
      if (Array.isArray(data?.rankings)) {
        this.globalRankingsSignal.set(data.rankings);
      }

      this.s3UrlSignal.set(data?.s3Url ?? null);
      this.imageUrlSignal.set(data?.imageUrl || base64DataUrl);
      this.metadataSignal.set({
        username: data?.username || user.displayName,
        tableName: data?.tableName,
        partitionKey: data?.partitionKey,
        s3Url: data?.s3Url ?? null,
        bucket: data?.bucket || 'profile',
        key: data?.key,
        contentType: data?.contentType || file.type,
        sizeBytes: data?.sizeBytes || file.size,
        updatedAt: data?.updatedAt || new Date().toISOString(),
      });
      this.successSignal.set(
        data?.message || 'Imagem salva no S3 e link registrado no DynamoDB com sucesso!',
      );
      return true;
    } catch (error) {
      this.errorSignal.set(
        (error as Error)?.message || 'Erro ao enviar imagem de perfil para POST /profile.',
      );
      return false;
    } finally {
      this.isUploadingSignal.set(false);
    }
  }

  /**
   * Adiciona novas mensagens trocadas com o agente de IA na lista local e
   * garante que estejam salvas na lista de mensagens do usuário no DynamoDB.
   */
  async appendChatMessages(
    newMessages: StoredChatMessage[],
    alreadySavedOnServer = false,
  ): Promise<void> {
    if (!newMessages.length) {
      return;
    }

    this.chatMessagesSignal.update((prev) => [...prev, ...newMessages]);

    if (alreadySavedOnServer) {
      return;
    }

    try {
      const user = this.authService.authState().user;
      const token = await this.authService.getJwtToken();
      if (!token || !user) {
        return;
      }

      const endpoint = this.endpointSignal();
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'append_messages',
          username: user.displayName,
          messages: newMessages,
        }),
      });

      if (response.ok) {
        const data = await response.json().catch(() => null);
        if (Array.isArray(data?.messages)) {
          this.chatMessagesSignal.set(data.messages);
        }
      }
    } catch {
      // Falha silenciosa de sincronização em background
    }
  }

  /** Sincroniza nova pontuação vencida pelo usuário no DynamoDB e atualiza o Ranking Global. */
  async syncScoreToDynamoDB(score: Score): Promise<void> {
    try {
      const user = this.authService.authState().user;
      const token = await this.authService.getJwtToken();
      if (!token || !user) {
        return;
      }

      const currentTeam = this.teamService.getCurrentTeam();
      const endpoint = this.endpointSignal();

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'save_score',
          username: user.displayName,
          score,
          teamId: currentTeam?.id ?? null,
          teamName: currentTeam?.name ?? 'Sem Equipe',
        }),
      });

      if (response.ok) {
        const data = await response.json().catch(() => null);
        if (Array.isArray(data?.rankings)) {
          this.globalRankingsSignal.set(data.rankings);
        }
      }
    } catch {
      // Ignora erro de rede em background
    }
  }

  /** Sincroniza a equipe escolhida pelo usuário no DynamoDB e atualiza o Ranking Global. */
  async syncTeamToDynamoDB(team: Team): Promise<void> {
    try {
      const user = this.authService.authState().user;
      const token = await this.authService.getJwtToken();
      if (!token || !user) {
        return;
      }

      const endpoint = this.endpointSignal();
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'save_team',
          username: user.displayName,
          teamId: team.id,
          teamName: team.name,
        }),
      });

      if (response.ok) {
        const data = await response.json().catch(() => null);
        if (Array.isArray(data?.rankings)) {
          this.globalRankingsSignal.set(data.rankings);
        }
      }
    } catch {
      // Ignora erro de rede em background
    }
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Falha ao ler os bytes do arquivo de imagem.'));
      reader.readAsDataURL(blob);
    });
  }
}
