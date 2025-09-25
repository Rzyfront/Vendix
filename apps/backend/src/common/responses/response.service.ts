import { Injectable } from '@nestjs/common';
import { StandardResponse } from './response.interface';

@Injectable()
export class ResponseService {
  /**
   * Creates a standardized success response
   * @param data The data to return
   * @param message Optional success message
   * @param meta Optional meta data
   * @returns Standardized success response
   */
  success<T>(
    data: T,
    message: string = 'Operation completed successfully',
    meta?: any,
  ): StandardResponse<T> {
    return {
      success: true,
      message,
      data,
      error: 'Everything is fine 😊',
      meta,
    };
  }

  /**
   * Creates a standardized error response
   * @param message Error message
   * @param errorDetail Error details
   * @param meta Optional meta data
   * @returns Standardized error response
   */
  error(
    message: string,
    errorDetail: string = 'An error occurred',
    meta?: any,
  ): StandardResponse<null> {
    return {
      success: false,
      message,
      data: null,
      error: errorDetail,
      meta,
    };
  }
}