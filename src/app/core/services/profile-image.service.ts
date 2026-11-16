import { Injectable, computed, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

export interface ProfileImageMetadata {
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

  private readonly endpointSignal = signal<string>(
    (environment as { profileApiUrl?: string }).profileApiUrl || DEFAULT_PROFILE_API_URL,
  );
  private readonly imageUrlSignal = signal<string | null>(null);
  private readonly metadataSignal = signal<ProfileImageMetadata | null>(null);
  private readonly isLoadingSignal = signal<boolean>(false);
  private readonly isUploadingSignal = signal<boolean>(false);
  private readonly errorSignal = signal<string | null>(null);
  private readonly successSignal = signal<string | null>(null);

  readonly apiEndpoint = computed(() => this.endpointSignal());
  readonly imageUrl = computed(() => this.imageUrlSignal());
  readonly metadata = computed(() => this.metadataSignal());
  readonly isLoading = computed(() => this.isLoadingSignal());
  readonly isUploading = computed(() => this.isUploadingSignal());
  readonly errorMessage = computed(() => this.errorSignal());
  readonly successMessage = computed(() => this.successSignal());

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
   * Lê a imagem de perfil do usuário no bucket S3 fazendo uma requisição
   * GET autenticada com o token JWT do Cognito na rota /profile do API Gateway.
   */
  async loadProfileImage(): Promise<void> {
    this.errorSignal.set(null);
    this.isLoadingSignal.set(true);

    try {
      const token = await this.authService.getJwtToken();
      if (!token) {
        this.errorSignal.set('Sessão Cognito não encontrada. Faça login para carregar sua foto de perfil.');
        return;
      }

      const endpoint = this.endpointSignal();
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (response.status === 404) {
        this.imageUrlSignal.set(null);
        this.metadataSignal.set(null);
        return;
      }

      if (!response.ok) {
        let errMsg = `Erro HTTP ${response.status} ao buscar imagem em GET /profile.`;
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

      // Suporta retorno em JSON ({ imageUrl: "data:image/..." }) ou binário direto (image/*)
      if (contentTypeHeader.startsWith('image/')) {
        const blob = await response.blob();
        const dataUrl = await this.blobToDataUrl(blob);
        this.imageUrlSignal.set(dataUrl);
        this.metadataSignal.set({
          contentType: contentTypeHeader,
          sizeBytes: blob.size,
        });
        return;
      }

      const data = (await response.json()) as {
        exists?: boolean;
        imageUrl?: string;
        bucket?: string;
        key?: string;
        contentType?: string;
        sizeBytes?: number;
        updatedAt?: string | null;
      };

      if (data?.imageUrl) {
        this.imageUrlSignal.set(data.imageUrl);
        this.metadataSignal.set({
          bucket: data.bucket,
          key: data.key,
          contentType: data.contentType,
          sizeBytes: data.sizeBytes,
          updatedAt: data.updatedAt,
        });
      } else {
        this.imageUrlSignal.set(null);
        this.metadataSignal.set(null);
      }
    } catch (error) {
      this.errorSignal.set(
        (error as Error)?.message || 'Não foi possível carregar a imagem de perfil via GET /profile.',
      );
    } finally {
      this.isLoadingSignal.set(false);
    }
  }

  /**
   * Envia exclusivamente um arquivo de imagem para a rota POST /profile do API Gateway
   * utilizando `fetch` com método `POST` e o cabeçalho `Authorization: Bearer <JWT>`.
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
      const token = await this.authService.getJwtToken();
      if (!token) {
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

      this.imageUrlSignal.set(data?.imageUrl || base64DataUrl);
      this.metadataSignal.set({
        bucket: data?.bucket || 'profile',
        key: data?.key,
        contentType: data?.contentType || file.type,
        sizeBytes: data?.sizeBytes || file.size,
        updatedAt: data?.updatedAt || new Date().toISOString(),
      });
      this.successSignal.set(
        data?.message || 'Imagem de perfil enviada com sucesso via POST /profile!',
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

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Falha ao ler os bytes do arquivo de imagem.'));
      reader.readAsDataURL(blob);
    });
  }
}
