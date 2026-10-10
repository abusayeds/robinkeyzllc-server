import { IsIn, IsNotEmpty, IsString } from 'class-validator';
export const MANAGEMENT_TYPES = {
  ABOUT: 'about',
  TERMS: 'terms',
  PRIVACY: 'privacy',
} as const;

export type ManagementType =
  (typeof MANAGEMENT_TYPES)[keyof typeof MANAGEMENT_TYPES];

export class crateManagementDto {
  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(Object.values(MANAGEMENT_TYPES), {
    message: `Type must be one of: ${Object.values(MANAGEMENT_TYPES).join(', ')}`,
  })
  type!: ManagementType;
}
