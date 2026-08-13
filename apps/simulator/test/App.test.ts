import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import App from '../src/App.vue';

describe('clean-room simulator shell', () => {
  it('starts disconnected and makes connection explicit', () => {
    const wrapper = mount(App);

    expect(wrapper.get('h1').text()).toBe('Trình mô phỏng thiết bị');
    expect(wrapper.get('[data-testid="connection-status"]').text()).toBe('Chưa kết nối');
    expect(wrapper.get('button').text()).toBe('Kết nối');
  });
});
