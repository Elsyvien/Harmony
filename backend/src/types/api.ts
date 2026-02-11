export interface ApiErrorResponse {
  code: string;
  message: string;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  isAdmin: boolean;
  createdAt: Date;
}
