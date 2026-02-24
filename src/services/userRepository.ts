import { BaseRepository } from './BaseRepository';
import { type User } from '../types';

class UserRepository extends BaseRepository<User> {
    constructor() {
        super('users');
    }
}

export const userRepository = new UserRepository();
