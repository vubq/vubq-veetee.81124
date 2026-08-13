import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import App from '../src/App.vue';

describe('management shell', () => {
  it('introduces the control surface and its initial areas', () => {
    const wrapper = mount(App);

    expect(wrapper.get('h1').text()).toBe('Điều khiển Veetee');
    expect(wrapper.text()).toContain('Thiết bị');
    expect(wrapper.text()).toContain('Nhà cung cấp');
    expect(wrapper.text()).toContain('Vận hành');
  });
});
