import { TestBed } from '@angular/core/testing';
import { Features } from './features';

describe('Features', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Features],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(Features);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render one button per tab with the first tab active', async () => {
    const fixture = TestBed.createComponent(Features);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    const buttons = element.querySelectorAll('.tab-btn');
    expect(buttons.length).toBe(6);
    expect(buttons[0].classList).toContain('active');
    expect(buttons[0].textContent).toContain('Modo Diário');
  });

  it('should switch the active tab when a button is clicked', async () => {
    const fixture = TestBed.createComponent(Features);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    const buttons = element.querySelectorAll<HTMLButtonElement>('.tab-btn');
    buttons[3].click();
    fixture.detectChanges();

    const panels = element.querySelectorAll('.tab-content');
    expect(panels[3].classList).toContain('active');
    expect(panels[0].classList).not.toContain('active');
    expect(buttons[3].classList).toContain('active');
    expect(buttons[0].classList).not.toContain('active');
  });
});
